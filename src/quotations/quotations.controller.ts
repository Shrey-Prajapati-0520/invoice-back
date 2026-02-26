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

  private normalizePhone(phone: string | null | undefined): string {
    if (!phone) return '';
    return String(phone).replace(/\D/g, '').slice(-10);
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

    const { data: profile } = await client
      .from('profiles')
      .select('phone, email')
      .eq('id', req.user.id)
      .single();
    const meta = (req.user as { user_metadata?: { phone?: string; email?: string } }).user_metadata ?? {};
    const profilePhone = (profile as { phone?: string } | null)?.phone ?? meta?.phone;
    const myPhone = this.normalizePhone(profilePhone);
    const profileEmail = (profile as { email?: string } | null)?.email ?? (req.user as { email?: string }).email ?? meta?.email ?? '';
    const myEmail = String(profileEmail).toLowerCase().trim();

    const receivedById = new Map<string, Record<string, unknown>>();
    if (myPhone) {
      const { data: byPhone } = await client
        .from('quotations')
        .select(`*, customers (id, name, phone, email)`)
        .neq('user_id', req.user.id)
        .eq('recipient_phone', myPhone)
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
        const raw = (cust as { phone?: string }).phone?.trim?.();
        recipientPhone = raw ? raw.replace(/\D/g, '').slice(-10) || null : null;
        recipientEmail = (cust as { email?: string }).email?.toLowerCase?.()?.trim() || null;
        if (!recipientPhone && !recipientEmail) {
          throw new BadRequestException(
            'Customer must have a phone number or email so the recipient can see this quotation when they sign up.',
          );
        }
      }
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

    // Receiver in-app notification
    const receiverIds = new Set<string>();
    if (recipientPhone) {
      const { data: byPhone } = await this.getClient()
        .from('profiles')
        .select('id')
        .eq('phone', recipientPhone)
        .neq('id', req.user.id);
      (byPhone ?? []).forEach((p: { id: string }) => receiverIds.add(p.id));
      if (receiverIds.size === 0) {
        const { data: byPhoneSuffix } = await this.getClient()
          .from('profiles')
          .select('id')
          .like('phone', `%${recipientPhone}`)
          .neq('id', req.user.id);
        (byPhoneSuffix ?? []).forEach((p: { id: string }) => receiverIds.add(p.id));
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

    // Push notifications: sender and receivers
    const pushRecipients: Array<{ token: string; title: string; body: string }> = [];
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
    const myPhone = this.normalizePhone(profilePhone);
    const myEmail = ((profile as { email?: string } | null)?.email ?? (req.user as { email?: string }).email ?? '')
      .toLowerCase()
      .trim();
    const rPhone = this.normalizePhone(q.recipient_phone);
    const rEmail = (q.recipient_email ?? '').toLowerCase().trim();
    const isRecipient =
      (myPhone && rPhone && myPhone === rPhone) || (myEmail && rEmail && myEmail === rEmail);
    if (!isRecipient) throw new NotFoundException('Quotation not found');
    return { ...q, type: 'received' };
  }
}
