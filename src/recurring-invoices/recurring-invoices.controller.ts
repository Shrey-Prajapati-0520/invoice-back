import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { SupabaseService } from '../supabase.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PushService } from '../push/push.service';
import { AuthGuard } from '../auth/auth.guard';
import {
  normalizePhone,
  phoneForStorage,
  emailForStorage,
} from '../recipient.util';

interface RecurringItemDto {
  name: string;
  qty?: number;
  rate?: number;
  sort_order?: number;
}

@Controller('recurring-invoices')
@UseGuards(AuthGuard)
export class RecurringInvoicesController {
  constructor(
    private supabase: SupabaseService,
    private notifications: NotificationsService,
    private push: PushService,
  ) {}

  private getClient() {
    return this.supabase.getClient();
  }

  @Get()
  async list(@Request() req: { user: { id: string; email?: string } }) {
    const client = this.getClient();

    const { data: profile, error: profileErr } = await client
      .from('profiles')
      .select('phone, email')
      .eq('id', req.user.id)
      .single();
    const meta = (req.user as { user_metadata?: { phone?: string; email?: string } }).user_metadata ?? {};
    const authEmail = (req.user as { email?: string }).email;
    const authPhone = (req.user as { phone?: string }).phone;
    const profilePhone = (profile as { phone?: string } | null)?.phone ?? meta?.phone;
    const profileEmail = (profile as { email?: string } | null)?.email ?? authEmail;
    const myPhone = profilePhone ? normalizePhone(profilePhone) : '';
    const myEmail = profileEmail ? (profileEmail as string).trim().toLowerCase() : '';

    const { data: sentData, error: sentErr } = await client
      .from('recurring_invoices')
      .select(`*, customers (id, name, phone, email), recurring_invoice_items (*)`)
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });
    if (sentErr) throw new BadRequestException(sentErr.message);
    const sent = (sentData ?? []).map((r: Record<string, unknown>) => ({ ...r, type: 'sent' }));

    const receivedById = new Map<string, Record<string, unknown>>();
    if (myPhone) {
      const { data: byPhone } = await client
        .from('recurring_invoices')
        .select(`*, customers (id, name, phone, email), recurring_invoice_items (*)`)
        .neq('user_id', req.user.id)
        .or(`recipient_phone.eq.${myPhone},recipient_phone.like.%${myPhone}`);
      (byPhone ?? []).forEach((r: Record<string, unknown>) =>
        receivedById.set(String(r.id), { ...r, type: 'received' }),
      );
    }
    if (myEmail) {
      const { data: byEmail } = await client
        .from('recurring_invoices')
        .select(`*, customers (id, name, phone, email), recurring_invoice_items (*)`)
        .neq('user_id', req.user.id)
        .ilike('recipient_email', myEmail);
      (byEmail ?? []).forEach((r: Record<string, unknown>) =>
        receivedById.set(String(r.id), { ...r, type: 'received' }),
      );
    }
    const received = Array.from(receivedById.values());

    return [...sent, ...received].sort(
      (a: { created_at?: string }, b: { created_at?: string }) =>
        (b.created_at ?? '').localeCompare(a.created_at ?? ''),
    );
  }

  @Post()
  async create(
    @Request() req: { user: { id: string } },
    @Body()
    body: {
      customer_id: string;
      recipient_phone?: string;
      recipient_email?: string;
      number?: string;
      name: string;
      frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
      generate_on?: 'day' | 'last';
      generate_day?: number;
      start_date: string;
      end_type?: 'never' | 'after' | 'ondate';
      end_after_count?: number;
      end_date?: string;
      payment_due_days?: string;
      auto_send?: boolean;
      notify_before_sending?: boolean;
      notify_days_before?: number;
      include_gst?: boolean;
      notes?: string;
      items?: RecurringItemDto[];
    },
  ) {
    if (!body.customer_id) {
      throw new BadRequestException('Customer is required');
    }
    if (!body.name?.trim()) {
      throw new BadRequestException('Recurring invoice name is required');
    }
    const items = body.items ?? [];
    const validItems = items.filter((i) => i?.name?.trim());
    if (validItems.length === 0) {
      throw new BadRequestException('At least one line item is required');
    }

    const { data: cust } = await this.getClient()
      .from('customers')
      .select('name, phone, email')
      .eq('id', body.customer_id)
      .eq('user_id', req.user.id)
      .single();
    if (!cust) throw new BadRequestException('Customer not found');

    let recipientPhone = phoneForStorage((cust as { phone?: string }).phone);
    let recipientEmail = emailForStorage((cust as { email?: string }).email);
    if (body.recipient_phone) recipientPhone = phoneForStorage(body.recipient_phone);
    if (body.recipient_email) recipientEmail = emailForStorage(body.recipient_email);
    if (!recipientPhone && !recipientEmail) {
      throw new BadRequestException(
        'Customer must have phone or email so the recipient can receive this recurring invoice.',
      );
    }

    const amount = validItems.reduce(
      (sum, it) => sum + (Number(it.qty) || 1) * (Number(it.rate) || 0),
      0,
    );
    const startDate = body.start_date ? new Date(body.start_date) : new Date();
    const generateDay = Math.min(31, Math.max(1, body.generate_day ?? 1));
    const generateOn = body.generate_on ?? 'day';

    let nextDate: Date;
    if (body.frequency === 'MONTHLY') {
      if (generateOn === 'last') {
        nextDate = new Date(startDate.getFullYear(), startDate.getMonth() + 1, 0);
      } else {
        nextDate = new Date(startDate.getFullYear(), startDate.getMonth(), generateDay);
      }
    } else if (body.frequency === 'WEEKLY') {
      nextDate = new Date(startDate);
      nextDate.setDate(nextDate.getDate() + 7);
    } else if (body.frequency === 'DAILY') {
      nextDate = new Date(startDate);
      nextDate.setDate(nextDate.getDate() + 1);
    } else if (body.frequency === 'YEARLY') {
      nextDate = new Date(startDate.getFullYear() + 1, startDate.getMonth(), generateOn === 'last' ? 0 : generateDay);
      if (generateOn === 'last') nextDate.setMonth(nextDate.getMonth() + 1), nextDate.setDate(0);
    } else {
      nextDate = new Date(startDate);
      nextDate.setMonth(nextDate.getMonth() + 3);
    }
    const nextDateStr = nextDate.toISOString().slice(0, 10);

    const payload: Record<string, unknown> = {
      user_id: req.user.id,
      customer_id: body.customer_id,
      recipient_phone: recipientPhone,
      recipient_email: recipientEmail,
      number: body.number?.trim() || `INV-REC-${Date.now()}`,
      client_name: (cust as { name?: string }).name ?? 'Customer',
      amount,
      frequency: body.frequency,
      next_date: nextDateStr,
      status: 'active',
      type: 'sent',
      start_date: body.start_date || nextDateStr,
      end_type: body.end_type ?? 'never',
      end_after_count: body.end_after_count ?? null,
      end_date: body.end_date || null,
      payment_due_days: body.payment_due_days ?? '30',
      auto_send: body.auto_send ?? true,
      name: body.name.trim(),
      generate_on: generateOn,
      generate_day: generateDay,
      notify_before_sending: body.notify_before_sending ?? true,
      notify_days_before: body.notify_days_before ?? 3,
      include_gst: body.include_gst ?? true,
      notes: body.notes?.trim() || null,
    };

    const { data: recurring, error: recErr } = await this.getClient()
      .from('recurring_invoices')
      .insert(payload)
      .select()
      .single();
    if (recErr) throw new BadRequestException(recErr.message);

    const lineItems = validItems.map((item, idx) => ({
      recurring_invoice_id: recurring.id,
      name: item.name?.trim() || 'Item',
      qty: typeof item.qty === 'number' ? item.qty : 1,
      rate: typeof item.rate === 'number' ? item.rate : parseFloat(String(item.rate || 0)) || 0,
      sort_order: item.sort_order ?? idx,
    }));
    const { error: itemsErr } = await this.getClient()
      .from('recurring_invoice_items')
      .insert(lineItems);
    if (itemsErr) throw new BadRequestException(itemsErr.message);

    const { data: fullRecurring } = await this.getClient()
      .from('recurring_invoices')
      .select(`*, customers (id, name, phone, email), recurring_invoice_items (*)`)
      .eq('id', recurring.id)
      .single();
    const resolved = fullRecurring ?? recurring;
    const customerName = (cust as { name?: string }).name ?? 'Customer';
    const amountStr = amount > 0 ? `₹${amount.toLocaleString('en-IN')}` : undefined;

    const { data: senderProfile } = await this.getClient()
      .from('profiles')
      .select('full_name, phone')
      .eq('id', req.user.id)
      .single();
    const senderName = (senderProfile as { full_name?: string } | null)?.full_name ?? 'A user';
    const senderPhone = (senderProfile as { phone?: string } | null)?.phone
      ? normalizePhone((senderProfile as { phone?: string }).phone)
      : null;

    // Sender notification
    try {
      await this.notifications.create({
        user_id: req.user.id,
        user_phone: senderPhone,
        title: `Recurring invoice "${resolved.name}" created for ${customerName}`,
        body: `You created recurring invoice ${resolved.name} for ${customerName}.`,
        type: 'recurring',
        reference_id: resolved.id,
        deep_link_screen: 'invoices',
      });
    } catch {
      /* non-fatal */
    }
    try {
      await this.getClient().from('messages').insert({
        user_id: req.user.id,
        title: `Recurring invoice "${resolved.name}" created`,
        description: `You created recurring invoice ${resolved.name} for ${customerName}.`,
        timestamp: new Date().toISOString(),
        icon: 'refresh',
        icon_color: '#7C3AED',
        unread: true,
      });
    } catch {
      /* non-fatal */
    }

    // Receiver (User B) – find by recipient phone/email
    const receiverIds = new Set<string>();
    if (recipientPhone) {
      try {
        const { data: byPhoneRpc } = await this.getClient()
          .rpc('find_receiver_ids_by_phone', { phone_10: recipientPhone, exclude_id: req.user.id });
        if (Array.isArray(byPhoneRpc)) {
          byPhoneRpc.forEach((r: { id?: string }) => r?.id && receiverIds.add(String(r.id)));
        }
      } catch {
        /* fallback */
      }
      if (receiverIds.size === 0) {
        const [exact, suffix] = await Promise.all([
          this.getClient()
            .from('profiles')
            .select('id')
            .eq('phone', recipientPhone)
            .neq('id', req.user.id),
          this.getClient()
            .from('profiles')
            .select('id')
            .neq('id', req.user.id)
            .ilike('phone', `%${recipientPhone}`),
        ]);
        [...(exact.data ?? []), ...(suffix.data ?? [])].forEach((p: { id: string }) =>
          receiverIds.add(p.id),
        );
      }
    }
    if (recipientEmail) {
      const { data: byEmail } = await this.getClient()
        .from('profiles')
        .select('id')
        .ilike('email', recipientEmail)
        .neq('id', req.user.id);
      (byEmail ?? []).forEach((p: { id: string }) => receiverIds.add(p.id));
    }

    const receiverPhones = new Map<string, string>();
    if (receiverIds.size > 0) {
      const { data: profiles } = await this.getClient()
        .from('profiles')
        .select('id, phone')
        .in('id', Array.from(receiverIds));
      (profiles ?? []).forEach((p: { id: string; phone?: string }) => {
        if (p.phone) receiverPhones.set(p.id, normalizePhone(p.phone));
      });
    }

    for (const receiverId of receiverIds) {
      try {
        await this.notifications.create({
          user_id: receiverId,
          user_phone: receiverPhones.get(receiverId) || null,
          title: `New recurring invoice from ${senderName}`,
          body: `${senderName} created recurring invoice "${resolved.name}"${amountStr ? ` for ${amountStr}` : ''} for you.`,
          type: 'recurring',
          reference_id: resolved.id,
          deep_link_screen: 'invoices',
        });
      } catch {
        /* non-fatal */
      }
      try {
        await this.getClient().from('messages').insert({
          user_id: receiverId,
          title: `New recurring invoice from ${senderName}`,
          description: `${senderName} created recurring invoice "${resolved.name}"${amountStr ? ` for ${amountStr}` : ''}.`,
          timestamp: new Date().toISOString(),
          icon: 'refresh',
          icon_color: '#7C3AED',
          unread: true,
        });
      } catch {
        /* non-fatal */
      }
    }

    // Push notifications: sender and all receivers
    const pushData = { type: 'recurring', id: resolved.id };
    const pushRecipients: Array<{ token: string; title: string; body: string; data?: Record<string, unknown> }> = [];
    const senderTokens = await this.push.getTokensForUser(req.user.id);
    for (const token of senderTokens) {
      pushRecipients.push({
        token,
        title: `Recurring invoice created`,
        body: `You created recurring invoice "${resolved.name}" for ${customerName}.`,
        data: pushData,
      });
    }
    for (const receiverId of receiverIds) {
      const receiverTokens = await this.push.getTokensForUser(receiverId);
      for (const token of receiverTokens) {
        pushRecipients.push({
          token,
          title: `New recurring invoice from ${senderName}`,
          body: `${senderName} created recurring invoice "${resolved.name}"${amountStr ? ` for ${amountStr}` : ''}.`,
          data: pushData,
        });
      }
    }
    if (pushRecipients.length > 0) {
      await this.push.sendMany(pushRecipients);
    }

    return resolved;
  }
}
