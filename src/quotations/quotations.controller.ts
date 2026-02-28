import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { SupabaseService } from '../supabase.service';
import { PushService } from '../push/push.service';
import { AuthGuard } from '../auth/auth.guard';
import {
  normalizePhone,
  normalizeEmail,
  phoneForStorage,
  emailForStorage,
} from '../recipient.util';

interface QuotationItemDto {
  name: string;
  qty?: number;
  rate?: number;
  sort_order?: number;
}

@Controller('quotations')
@UseGuards(AuthGuard)
export class QuotationsController {
  constructor(
    private supabase: SupabaseService,
    private push: PushService,
  ) {}

  private getClient() {
    return this.supabase.getClient();
  }

  @Get()
  async list(@Request() req: { user: { id: string; email?: string } }) {
    const client = this.getClient();
    const { data: sentData, error: sentErr } = await client
      .from('quotations')
      .select(`*, customers (id, name, phone, email)`)
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });
    if (sentErr) throw new BadRequestException(sentErr.message);
    const sent = sentData ?? [];

    let { data: profile, error: profileErr } = await client
      .from('profiles')
      .select('phone, email')
      .eq('id', req.user.id)
      .single();
    const meta = (req.user as { user_metadata?: { phone?: string; email?: string } }).user_metadata ?? {};
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
    if (myPhone) {
      const { data: byPhone } = await client
        .from('quotations')
        .select(`*, customers (id, name, phone, email)`)
        .neq('user_id', req.user.id)
        .or(`recipient_phone.eq.${myPhone},recipient_phone.like.%${myPhone}`)
        .order('created_at', { ascending: false });
      (byPhone ?? []).forEach((quo: Record<string, unknown>) => receivedById.set(String(quo.id), { ...quo, type: 'received' }));
    }
    if (myEmail) {
      const { data: byEmail } = await client
        .from('quotations')
        .select(`*, customers (id, name, phone, email)`)
        .neq('user_id', req.user.id)
        .ilike('recipient_email', myEmail)
        .order('created_at', { ascending: false });
      (byEmail ?? []).forEach((quo: Record<string, unknown>) => receivedById.set(String(quo.id), { ...quo, type: 'received' }));
    }
    const received = Array.from(receivedById.values());

    return [...sent, ...received].sort(
      (a: { created_at?: string; date?: string }, b: { created_at?: string; date?: string }) =>
        (b.created_at ?? b.date ?? '').localeCompare(a.created_at ?? a.date ?? ''),
    );
  }

  @Post()
  async create(
    @Request() req: { user: { id: string } },
    @Body()
    body: {
      customer_id?: string;
      quo_number: string;
      client_name?: string;
      amount: number;
      date?: string;
      valid_until?: string;
      status?: 'converted' | 'draft' | 'sent' | 'accepted' | 'rejected';
      type?: 'sent' | 'received';
      items?: QuotationItemDto[];
    },
  ) {
    if (!body?.quo_number?.trim()) {
      throw new BadRequestException('Quote number is required');
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
    const manualPhone = phoneForStorage((body as { recipient_phone?: string }).recipient_phone);
    const manualEmail = emailForStorage((body as { recipient_email?: string }).recipient_email);
    if (manualPhone) recipientPhone = manualPhone;
    if (manualEmail) recipientEmail = manualEmail;
    if (!recipientPhone && !recipientEmail) {
      throw new BadRequestException(
        'Customer must have a phone or email, or provide recipient_phone/recipient_email, so the recipient can see this quotation when they sign up.',
      );
    }
    const payload = {
      user_id: req.user.id,
      customer_id: body.customer_id || null,
      recipient_phone: recipientPhone,
      recipient_email: recipientEmail,
      quo_number: body.quo_number.trim(),
      client_name: body.client_name || null,
      amount: Number(body.amount) || 0,
      date: body.date || new Date().toISOString().slice(0, 10),
      version: 'v1',
      valid_until: body.valid_until || null,
      view_status: null,
      status: body.status || 'draft',
      type: body.type || 'sent',
    };
    const { data: quotation, error: quoError } = await this.getClient()
      .from('quotations')
      .insert(payload)
      .select()
      .single();
    if (quoError) throw new BadRequestException(quoError.message);

    const items = body.items ?? [];
    if (items.length > 0) {
      const lineItems = items.map((item, idx) => ({
        quotation_id: quotation.id,
        name: item.name || 'Item',
        qty: typeof item.qty === 'number' ? item.qty : 1,
        rate: typeof item.rate === 'number' ? item.rate : parseFloat(String(item.rate || 0)) || 0,
        sort_order: item.sort_order ?? idx,
      }));
      const { error: itemsError } = await this.getClient()
        .from('quotation_items')
        .insert(lineItems);
      if (itemsError) throw new BadRequestException(itemsError.message);
    }

    const { data: fullQuotation } = await this.getClient()
      .from('quotations')
      .select(
        `*,
        customers (id, name, phone, email),
        quotation_items (*)`,
      )
      .eq('id', quotation.id)
      .single();

    const resolved = fullQuotation ?? quotation;
    const customer = resolved?.customers as { name?: string } | null;
    const customerName = customer?.name ?? 'Customer';

    const { data: senderProfile } = await this.getClient()
      .from('profiles')
      .select('full_name')
      .eq('id', req.user.id)
      .single();
    const senderName = (senderProfile as { full_name?: string } | null)?.full_name ?? 'A user';

    // Sender notification
    try {
      await this.getClient().from('messages').insert({
        user_id: req.user.id,
        title: `Quotation ${resolved.quo_number} sent to ${customerName}`,
        description: `You sent quotation ${resolved.quo_number} to ${customerName} for ₹${Number(resolved.amount || 0).toLocaleString('en-IN')}.`,
        timestamp: new Date().toISOString(),
        icon: 'document-text',
        icon_color: '#7C3AED',
        unread: true,
      });
    } catch {
      /* non-fatal */
    }

    // Receiver in-app notification: find User B by recipient phone/email
    const receiverIds = new Set<string>();
    if (recipientPhone) {
      try {
        const { data: byPhoneRpc } = await this.getClient()
          .rpc('find_receiver_ids_by_phone', { phone_10: recipientPhone, exclude_id: req.user.id });
        if (Array.isArray(byPhoneRpc)) {
          byPhoneRpc.forEach((r: { id?: string }) => r?.id && receiverIds.add(String(r.id)));
        }
      } catch {
        /* RPC may not exist; fall through */
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
          receiverIds.add(String(p.id)),
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
    for (const receiverId of receiverIds) {
      try {
        await this.getClient().from('messages').insert({
          user_id: receiverId,
          title: `New quotation ${resolved.quo_number} from ${senderName}`,
          description: `${senderName} sent you quotation ${resolved.quo_number} for ₹${Number(resolved.amount || 0).toLocaleString('en-IN')}.`,
          timestamp: new Date().toISOString(),
          icon: 'document-text',
          icon_color: '#7C3AED',
          unread: true,
        });
      } catch {
        /* non-fatal */
      }
    }

    // Push notifications: sender and receiver (native device notifications for both)
    const pushData = { type: 'quotation', id: resolved.id };
    const pushRecipients: Array<{ token: string; title: string; body: string; data?: Record<string, unknown> }> = [];
    const { data: senderTokenRow } = await this.getClient()
      .from('profiles')
      .select('expo_push_token')
      .eq('id', req.user.id)
      .single();
    const senderToken = (senderTokenRow as { expo_push_token?: string } | null)?.expo_push_token;
    if (senderToken) {
      pushRecipients.push({
        token: senderToken,
        title: `Quotation ${resolved.quo_number} sent`,
        body: `You sent quotation ${resolved.quo_number} to ${customerName}.`,
        data: pushData,
      });
    }
    for (const receiverId of receiverIds) {
      const { data: receiverTokenRow } = await this.getClient()
        .from('profiles')
        .select('expo_push_token')
        .eq('id', receiverId)
        .single();
      const receiverToken = (receiverTokenRow as { expo_push_token?: string } | null)?.expo_push_token;
      if (receiverToken) {
        pushRecipients.push({
          token: receiverToken,
          title: `New quotation from ${senderName}`,
          body: `${senderName} sent you quotation ${resolved.quo_number} for ₹${Number(resolved.amount || 0).toLocaleString('en-IN')}.`,
          data: pushData,
        });
      }
    }
    if (pushRecipients.length > 0) {
      await this.push.sendMany(pushRecipients);
    }

    return resolved;
  }

  @Get(':id')
  async get(
    @Request() req: { user: { id: string; email?: string } },
    @Param('id') id: string,
  ) {
    const client = this.getClient();
    const { data: q, error } = await client
      .from('quotations')
      .select(`*, customers (id, name, phone, email), quotation_items (*)`)
      .eq('id', id)
      .single();
    if (error || !q) throw new NotFoundException('Quotation not found');
    const isOwner = q.user_id === req.user.id;
    if (isOwner) return q;
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
    const rPhone = normalizePhone(q.recipient_phone);
    const rEmail = normalizeEmail(q.recipient_email);
    const isRecipient =
      (myPhone && rPhone && myPhone === rPhone) || (myEmail && rEmail && myEmail === rEmail);
    if (!isRecipient) throw new NotFoundException('Quotation not found');
    return { ...q, type: 'received' };
  }
}
