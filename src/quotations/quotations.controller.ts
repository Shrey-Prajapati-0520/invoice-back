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
  constructor(private supabase: SupabaseService) {}

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
    const myPhone = this.normalizePhone((profile as { phone?: string } | null)?.phone);
    const myEmail = ((profile as { email?: string } | null)?.email ?? req.user.email ?? '')
      .toLowerCase()
      .trim();

    let received: unknown[] = [];
    if (myPhone || myEmail) {
      const orParts: string[] = [];
      if (myPhone) orParts.push(`recipient_phone.eq.${myPhone}`);
      if (myEmail) orParts.push(`recipient_email.eq.${myEmail}`);
      const orFilter = orParts.join(',');
      const q = client
        .from('quotations')
        .select(`*, customers (id, name, phone, email)`)
        .neq('user_id', req.user.id)
        .or(orFilter)
        .order('created_at', { ascending: false });
      const { data: receivedData } = await q;
      const all = receivedData ?? [];
      received = all.map((quo: Record<string, unknown>) => ({ ...quo, type: 'received' }));
    }

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
        `
        *,
        customers (id, name, phone, email),
        quotation_items (*)
      `,
      )
      .eq('id', quotation.id)
      .single();

    return fullQuotation ?? quotation;
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
    const myPhone = this.normalizePhone((profile as { phone?: string } | null)?.phone);
    const myEmail = ((profile as { email?: string } | null)?.email ?? req.user.email ?? '')
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
