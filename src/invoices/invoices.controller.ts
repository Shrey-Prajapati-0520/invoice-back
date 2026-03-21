import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  NotFoundException,
  Param,
  Patch,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { SupabaseService } from '../supabase.service';
import { MailService } from '../mail/mail.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PushService } from '../push/push.service';
import { AuthGuard } from '../auth/auth.guard';
import { InvoiceRealtimeGateway } from '../invoice-realtime/invoice-realtime.gateway';
import {
  normalizePhone,
  normalizeEmail,
  phoneForStorage,
  emailForStorage,
  escapeForLike,
} from '../recipient.util';
import { findReceiverIds } from '../receiver-lookup.util';

interface InvoiceItemDto {
  name: string;
  qty?: number;
  rate?: number;
  sort_order?: number;
}

@Controller('invoices')
@UseGuards(AuthGuard)
@Throttle({ default: { limit: 60, ttl: 60000 } })
export class InvoicesController {
  private readonly logger = new Logger(InvoicesController.name);

  constructor(
    private supabase: SupabaseService,
    private mail: MailService,
    private notifications: NotificationsService,
    private push: PushService,
    private invoiceRealtime: InvoiceRealtimeGateway,
  ) {}

  private getClient() {
    return this.supabase.getClient();
  }

  @Get()
  async list(@Request() req: { user: { id: string; email?: string } }) {
    const client = this.getClient();
    const { data: sentData, error: sentErr } = await client
      .from('invoices')
      .select(`*, customers (id, name, phone, email), invoice_items (qty, rate)`)
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });
    if (sentErr) throw new BadRequestException(sentErr.message);
    const withAmount = (inv: Record<string, unknown>) => {
      const items = (inv.invoice_items ?? []) as { qty?: number; rate?: number }[];
      const amt = items.reduce(
        (s: number, i: { qty?: number; rate?: number }) =>
          s + (Number(i.qty) || 1) * (Number(i.rate) || 0),
        0,
      );
      return { ...inv, type: 'sent', amount: amt };
    };
    const sent = (sentData ?? []).map(withAmount);

    let { data: profile, error: profileErr } = await client
      .from('profiles')
      .select('phone, email')
      .eq('id', req.user.id)
      .single();
    const meta = (req.user as { user_metadata?: { phone?: string; email?: string; full_name?: string } }).user_metadata ?? {};
    const authEmail = (req.user as { email?: string }).email;
    const authPhone = (req.user as { phone?: string }).phone;
    const metaPhone = meta?.phone ?? authPhone;
    const metaEmail = meta?.email ?? authEmail;

    // Ensure profile exists (handles race where handle_new_user hasn't run)
    if (!profile && profileErr?.code === 'PGRST116') {
      const initPhone = metaPhone && normalizePhone(metaPhone).length >= 10 ? normalizePhone(metaPhone) : null;
      const initEmail = metaEmail || authEmail ? normalizeEmail(metaEmail || authEmail) : null;
      try {
        const { data: inserted } = await client
          .from('profiles')
          .upsert(
            {
              id: req.user.id,
              full_name: meta?.full_name ?? null,
              email: initEmail,
              phone: initPhone,
            },
            { onConflict: 'id' },
          )
          .select('phone, email')
          .single();
        if (inserted) profile = inserted;
      } catch {
        /* non-fatal; continue with auth metadata */
      }
    }

    // Sync profile if missing phone/email from user_metadata (ensures User B can receive)
    const storedPhone = (profile as { phone?: string } | null)?.phone;
    const storedEmail = (profile as { email?: string } | null)?.email;
    const needsPhoneSync = !storedPhone && metaPhone && normalizePhone(metaPhone).length >= 10;
    const needsEmailSync = !storedEmail && (metaEmail || authEmail);
    if (needsPhoneSync || needsEmailSync) {
      const updates: Record<string, string | null> = {};
      if (needsPhoneSync) updates.phone = normalizePhone(metaPhone);
      if (needsEmailSync) updates.email = normalizeEmail(metaEmail || authEmail) || null;
      if (Object.keys(updates).length > 0) {
        try {
          const { data: synced } = await client
            .from('profiles')
            .update(updates)
            .eq('id', req.user.id)
            .select('phone, email')
            .single();
          if (synced) profile = synced as typeof profile;
        } catch {
          /* non-fatal */
        }
      }
    }

    // Prefer auth identity first (always in JWT) – ensures "receiver comes after" works when
    // profile is empty or not yet synced; profile can be stale on first request after cold start.
    const profilePhone = (profile as { phone?: string } | null)?.phone;
    const profileEmail = (profile as { email?: string } | null)?.email;
    const myPhone = normalizePhone(metaPhone || authPhone || profilePhone || '');
    const myEmail = normalizeEmail(authEmail || metaEmail || profileEmail || '');

    const receivedById = new Map<string, Record<string, unknown>>();
    const addReceived = (inv: Record<string, unknown>) => {
      const items = (inv.invoice_items ?? []) as { qty?: number; rate?: number }[];
      const amt = items.reduce(
        (s: number, i: { qty?: number; rate?: number }) =>
          s + (Number(i.qty) || 1) * (Number(i.rate) || 0),
        0,
      );
      receivedById.set(String(inv.id), { ...inv, type: 'received', amount: amt });
    };

    try {
      const { data: byReceiverId } = await client
        .from('invoices')
        .select(`*, customers (id, name, phone, email), invoice_items (qty, rate)`)
        .eq('receiver_id', req.user.id)
        .order('created_at', { ascending: false });
      (byReceiverId ?? []).forEach((inv: Record<string, unknown>) => addReceived(inv));
    } catch (e) {
      this.logger.warn(`receiver_id query failed (run supabase/invoice-receiver-id.sql): ${(e as Error)?.message}`);
    }

    if (myPhone) {
      const { data: byPhone } = await client
        .from('invoices')
        .select(`*, customers (id, name, phone, email), invoice_items (qty, rate)`)
        .neq('user_id', req.user.id)
        .or(`recipient_phone.eq.${myPhone},recipient_phone.like.%${escapeForLike(myPhone)}`)
        .order('created_at', { ascending: false });
      const toAssignByPhone = (byPhone ?? []).filter((inv: Record<string, unknown>) => !inv.receiver_id);
      if (toAssignByPhone.length > 0) {
        const ids = toAssignByPhone.map((inv: Record<string, unknown>) => inv.id).filter(Boolean) as string[];
        if (ids.length > 0) {
          try {
            await client.from('invoices').update({ receiver_id: req.user.id }).in('id', ids).is('receiver_id', null);
          } catch (e) {
            this.logger.warn(`Auto-assign receiver_id by phone failed (non-fatal): ${(e as Error)?.message}`);
          }
        }
      }
      (byPhone ?? []).forEach((inv: Record<string, unknown>) => addReceived(inv));
    }
    if (myEmail) {
      const { data: byEmail } = await client
        .from('invoices')
        .select(`*, customers (id, name, phone, email), invoice_items (qty, rate)`)
        .neq('user_id', req.user.id)
        .ilike('recipient_email', myEmail)
        .order('created_at', { ascending: false });
      const toAssignByEmail = (byEmail ?? []).filter((inv: Record<string, unknown>) => !inv.receiver_id);
      if (toAssignByEmail.length > 0) {
        const ids = toAssignByEmail.map((inv: Record<string, unknown>) => inv.id).filter(Boolean) as string[];
        if (ids.length > 0) {
          try {
            await client.from('invoices').update({ receiver_id: req.user.id }).in('id', ids).is('receiver_id', null);
          } catch (e) {
            this.logger.warn(`Auto-assign receiver_id by email failed (non-fatal): ${(e as Error)?.message}`);
          }
        }
      }
      (byEmail ?? []).forEach((inv: Record<string, unknown>) => addReceived(inv));
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
      customer_id?: string;
      number: string;
      due_date?: string;
      status?: 'paid' | 'pending' | 'overdue';
      type?: 'sent' | 'received';
      notes?: string;
      include_gst?: boolean;
      payment_type?: 'full' | 'milestone' | 'recurring';
      enable_reminders?: boolean;
      items?: InvoiceItemDto[];
    },
  ) {
    if (!body?.number?.trim()) {
      throw new BadRequestException('Invoice number is required');
    }
    let recipientPhone: string | null = null;
    let recipientEmail: string | null = null;
    if (body.customer_id) {
      const { data: cust } = await this.getClient()
        .from('customers')
        .select('phone, email')
        .eq('id', body.customer_id)
        .eq('user_id', req.user.id)
        .single();
      if (cust) {
        recipientPhone = phoneForStorage((cust as { phone?: string }).phone);
        recipientEmail = emailForStorage((cust as { email?: string }).email);
      }
    }
    // Allow manual override when no customer or to ensure recipient match
    const manualPhone = phoneForStorage((body as { recipient_phone?: string }).recipient_phone);
    const manualEmail = emailForStorage((body as { recipient_email?: string }).recipient_email);
    if (manualPhone) recipientPhone = manualPhone;
    if (manualEmail) recipientEmail = manualEmail;
    if (!recipientPhone && !recipientEmail) {
      throw new BadRequestException(
        'Customer must have a phone or email, or provide recipient_phone/recipient_email, so the recipient can see this invoice when they sign up.',
      );
    }

    const receiverIds = await findReceiverIds({
      recipientPhone,
      recipientEmail,
      excludeId: req.user.id,
      getClient: () => this.getClient(),
      logContext: `invoice create`,
      onLog: (msg) => this.logger.log(msg),
    });
    const primaryReceiverId = receiverIds.size > 0 ? Array.from(receiverIds)[0] : null;

    const invoicePayload = {
      user_id: req.user.id,
      receiver_id: primaryReceiverId,
      customer_id: body.customer_id || null,
      recipient_phone: recipientPhone,
      recipient_email: recipientEmail,
      number: body.number.trim(),
      due_date: body.due_date || null,
      status: body.status || 'pending',
      type: body.type || 'sent',
      notes: body.notes || null,
      include_gst: body.include_gst ?? true,
      payment_type: body.payment_type || null,
      enable_reminders: body.enable_reminders ?? false,
    };
    const { data: invoice, error: invError } = await this.getClient()
      .from('invoices')
      .insert(invoicePayload)
      .select()
      .single();
    if (invError) throw new BadRequestException(invError.message);

    const items = body.items ?? [];
    if (items.length > 0) {
      const lineItems = items.map((item, idx) => ({
        invoice_id: invoice.id,
        name: item.name || 'Item',
        qty: typeof item.qty === 'number' ? item.qty : 1,
        rate: typeof item.rate === 'number' ? item.rate : parseFloat(String(item.rate || 0)) || 0,
        sort_order: item.sort_order ?? idx,
      }));
      const { error: itemsError } = await this.getClient()
        .from('invoice_items')
        .insert(lineItems);
      if (itemsError) throw new BadRequestException(itemsError.message);
    }

    const { data: fullInvoice } = await this.getClient()
      .from('invoices')
      .select(
        `
        *,
        customers (id, name, phone, email),
        invoice_items (*)
      `,
      )
      .eq('id', invoice.id)
      .single();

    const resolved = fullInvoice ?? invoice;
    const customer = resolved?.customers as { name?: string; email?: string } | null;
    const customerName = customer?.name ?? 'Customer';
    const customerEmail = customer?.email?.trim();

    const invoiceItems = resolved?.invoice_items ?? [];
    const total = invoiceItems.reduce(
      (sum: number, it: { qty?: number; rate?: number }) =>
        sum + (Number(it.qty) || 0) * (Number(it.rate) || 0),
      0,
    );
    const amountStr = total > 0 ? `₹${total.toLocaleString('en-IN')}` : undefined;
    const { data: senderProfile } = await this.getClient()
      .from('profiles')
      .select('full_name, phone')
      .eq('id', req.user.id)
      .single();
    const senderName = (senderProfile as { full_name?: string } | null)?.full_name ?? 'A user';
    const senderPhone = (senderProfile as { phone?: string } | null)?.phone
      ? normalizePhone((senderProfile as { phone?: string }).phone)
      : null;

    // Sender notification (notifications table – deep link support)
    try {
      await this.notifications.create({
        user_id: req.user.id,
        user_phone: senderPhone,
        title: `Invoice ${resolved.number} sent to ${customerName}`,
        body: `You sent invoice ${resolved.number} to ${customerName}.`,
        type: 'invoice',
        reference_id: resolved.id,
        deep_link_screen: 'invoices',
      });
    } catch {
      /* non-fatal */
    }
    // Legacy messages (backward compat)
    try {
      await this.getClient().from('messages').insert({
        user_id: req.user.id,
        title: `Invoice ${resolved.number} sent to ${customerName}`,
        description: `You sent invoice ${resolved.number} to ${customerName}.`,
        timestamp: new Date().toISOString(),
        icon: 'document-text',
        icon_color: '#7C3AED',
        unread: true,
      });
    } catch {
      /* non-fatal */
    }

    // Receiver in-app notification (receiverIds already resolved at create time)
    // Fetch receiver phones for notifications
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
          title: `New invoice ${resolved.number} from ${senderName}`,
          body: `${senderName} sent you invoice ${resolved.number}${amountStr ? ` for ${amountStr}` : ''}.`,
          type: 'invoice',
          reference_id: resolved.id,
          deep_link_screen: 'invoices',
        });
      } catch {
        /* non-fatal */
      }
      try {
        await this.getClient().from('messages').insert({
          user_id: receiverId,
          title: `New invoice ${resolved.number} from ${senderName}`,
          description: `${senderName} sent you invoice ${resolved.number}${amountStr ? ` for ${amountStr}` : ''}.`,
          timestamp: new Date().toISOString(),
          icon: 'document-text',
          icon_color: '#7C3AED',
          unread: true,
        });
      } catch {
        /* non-fatal */
      }
    }

    // Receiver email: send in background (don't block response – same as quotation flow)
    if (customerEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) {
      this.mail
        .sendInvoiceNotificationToReceiver({
          to: customerEmail,
          senderName: senderName,
          invoiceNumber: resolved.number,
          amount: amountStr,
        })
        .catch(() => {});
    }

    // Push notifications: sender and receiver (supports multiple devices per user)
    try {
      const pushData = { type: 'invoice', id: resolved.id };
      const pushRecipients: Array<{ token: string; title: string; body: string; data?: Record<string, unknown> }> = [];
      const senderTokens = await this.push.getTokensForUser(req.user.id);
      for (const token of senderTokens) {
        pushRecipients.push({
          token,
          title: `Invoice ${resolved.number} sent`,
          body: `You sent invoice ${resolved.number} to ${customerName}.`,
          data: pushData,
        });
      }
      for (const receiverId of receiverIds) {
        const receiverTokens = await this.push.getTokensForUser(receiverId);
        if (receiverTokens.length === 0) {
          this.logger.log(`[Push] User ${receiverId} has 0 tokens – no push sent`);
        }
        for (const token of receiverTokens) {
          pushRecipients.push({
            token,
            title: `New invoice from ${senderName}`,
            body: `${senderName} sent you invoice ${resolved.number}${amountStr ? ` for ${amountStr}` : ''}.`,
            data: pushData,
          });
        }
      }
      if (pushRecipients.length > 0) {
        await this.push.sendMany(pushRecipients);
        this.logger.log(`[Push] Sent to ${senderTokens.length} sender + ${pushRecipients.length - senderTokens.length} receiver token(s)`);
      }
    } catch (pushErr) {
      this.logger.warn(`[Push] Invoice ${resolved.number} push failed (non-fatal):`, (pushErr as Error)?.message);
    }

    // Realtime: emit to WebSocket subscribers (User B with app open)
    try {
      this.invoiceRealtime.emitNewInvoice(
        recipientPhone,
        Array.from(receiverIds),
        resolved as unknown as Record<string, unknown>,
      );
    } catch {
      /* non-fatal */
    }

    return resolved;
  }

  @Get(':id')
  async get(
    @Request() req: { user: { id: string; email?: string } },
    @Param('id') id: string,
  ) {
    const client = this.getClient();
    const { data: inv, error } = await client
      .from('invoices')
      .select(`*, customers (id, name, phone, email), invoice_items (*)`)
      .eq('id', id)
      .single();
    if (error || !inv) throw new NotFoundException('Invoice not found');
    const isOwner = inv.user_id === req.user.id;
    if (isOwner) return inv;
    const { data: profile } = await client
      .from('profiles')
      .select('phone, email')
      .eq('id', req.user.id)
      .single();
    const meta = (req.user as { user_metadata?: { phone?: string } }).user_metadata ?? {};
    const profilePhone = (profile as { phone?: string } | null)?.phone ?? meta?.phone;
    const myPhone = normalizePhone(profilePhone);
    const myEmail = normalizeEmail(
      (profile as { email?: string } | null)?.email ?? (req.user as { email?: string }).email ?? '',
    );
    const rPhone = normalizePhone(inv.recipient_phone);
    const rEmail = normalizeEmail(inv.recipient_email);
    const isRecipient =
      (myPhone && rPhone && myPhone === rPhone) || (myEmail && rEmail && myEmail === rEmail);
    if (!isRecipient) throw new NotFoundException('Invoice not found');
    return { ...inv, type: 'received' };
  }

  @Patch(':id')
  async update(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
    @Body()
    body: Partial<{
      customer_id: string;
      number: string;
      due_date: string;
      status: 'paid' | 'pending' | 'overdue';
      type: 'sent' | 'received';
      notes: string;
      include_gst: boolean;
      payment_type: string;
    }>,
  ) {
    const { data, error } = await this.getClient()
      .from('invoices')
      .update(body)
      .eq('id', id)
      .eq('user_id', req.user.id)
      .select(`*, customers (id, name, phone, email), invoice_items (*)`)
      .single();
    if (error) throw new BadRequestException(error.message);
    const inv = data as { recipient_phone?: string; recipient_email?: string } | null;
    const recipientPhone = inv?.recipient_phone ? normalizePhone(inv.recipient_phone) : null;
    const recipientEmail = inv?.recipient_email?.trim() || null;
    const receiverIds = await findReceiverIds({
      recipientPhone,
      recipientEmail,
      excludeId: req.user.id,
      getClient: () => this.getClient(),
      logContext: `invoice update ${id}`,
      onLog: (msg) => this.logger.log(msg),
    });
    try {
      this.invoiceRealtime.emitInvoiceUpdated(
        req.user.id,
        recipientPhone,
        Array.from(receiverIds),
        (data ?? inv) as unknown as Record<string, unknown>,
      );
    } catch {
      /* non-fatal */
    }
    return data;
  }

  @Delete(':id')
  async delete(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
  ) {
    const { data, error } = await this.getClient()
      .from('invoices')
      .delete()
      .eq('id', id)
      .eq('user_id', req.user.id)
      .select('id');
    if (error) throw new BadRequestException(error.message);
    if (!data?.length) throw new NotFoundException('Invoice not found');
    return { success: true };
  }

  @Post(':id/items')
  async addItem(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
    @Body() body: { name: string; qty?: number; rate?: number; sort_order?: number },
  ) {
    const { data: inv } = await this.getClient()
      .from('invoices')
      .select('id')
      .eq('id', id)
      .eq('user_id', req.user.id)
      .single();
    if (!inv) throw new NotFoundException('Invoice not found');

    const { data, error } = await this.getClient()
      .from('invoice_items')
      .insert({
        invoice_id: id,
        name: body.name || 'Item',
        qty: body.qty ?? 1,
        rate: body.rate ?? 0,
        sort_order: body.sort_order ?? 0,
      })
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  @Delete(':id/items/:itemId')
  async removeItem(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
    @Param('itemId') itemId: string,
  ) {
    const { data: inv } = await this.getClient()
      .from('invoices')
      .select('id')
      .eq('id', id)
      .eq('user_id', req.user.id)
      .single();
    if (!inv) throw new NotFoundException('Invoice not found');

    const { data: deleted, error } = await this.getClient()
      .from('invoice_items')
      .delete()
      .eq('id', itemId)
      .eq('invoice_id', id)
      .select('id');
    if (error) throw new BadRequestException(error.message);
    if (!deleted?.length) throw new NotFoundException('Item not found');
    return { success: true };
  }
}
