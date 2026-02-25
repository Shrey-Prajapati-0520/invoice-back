import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { SupabaseService } from '../supabase.service';
import { MailService } from '../mail/mail.service';
import { AuthGuard } from '../auth/auth.guard';

interface InvoiceItemDto {
  name: string;
  qty?: number;
  rate?: number;
  sort_order?: number;
}

@Controller('invoices')
@UseGuards(AuthGuard)
export class InvoicesController {
  constructor(
    private supabase: SupabaseService,
    private mail: MailService,
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
      .from('invoices')
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
        .from('invoices')
        .select(`*, customers (id, name, phone, email)`)
        .neq('user_id', req.user.id)
        .eq('recipient_phone', myPhone)
        .order('created_at', { ascending: false });
      (byPhone ?? []).forEach((inv: Record<string, unknown>) => receivedById.set(String(inv.id), { ...inv, type: 'received' }));
    }
    if (myEmail) {
      const { data: byEmail } = await client
        .from('invoices')
        .select(`*, customers (id, name, phone, email)`)
        .neq('user_id', req.user.id)
        .eq('recipient_email', myEmail)
        .order('created_at', { ascending: false });
      (byEmail ?? []).forEach((inv: Record<string, unknown>) => receivedById.set(String(inv.id), { ...inv, type: 'received' }));
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
        const raw = (cust as { phone?: string; email?: string }).phone?.trim?.();
        recipientPhone = raw ? raw.replace(/\D/g, '').slice(-10) || null : null;
        recipientEmail = (cust as { email?: string }).email?.toLowerCase?.()?.trim() || null;
        if (!recipientPhone && !recipientEmail) {
          throw new BadRequestException(
            'Customer must have a phone number or email so the recipient can see this invoice when they sign up.',
          );
        }
      }
    }
    const invoicePayload = {
      user_id: req.user.id,
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
      .select('full_name')
      .eq('id', req.user.id)
      .single();
    const senderName = (senderProfile as { full_name?: string } | null)?.full_name ?? 'A user';

    // Sender notification: insert into messages for the creator
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

    // Receiver in-app notification: find user by recipient phone/email and insert message
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

    // Receiver email: send email to customer if they have an email
    if (customerEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) {
      try {
        await this.mail.sendInvoiceNotificationToReceiver({
          to: customerEmail,
          senderName: senderName,
          invoiceNumber: resolved.number,
          amount: amountStr,
        });
      } catch {
        // Non-fatal; invoice was created successfully
      }
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
    const myPhone = this.normalizePhone(profilePhone);
    const myEmail = ((profile as { email?: string } | null)?.email ?? (req.user as { email?: string }).email ?? '')
      .toLowerCase()
      .trim();
    const rPhone = this.normalizePhone(inv.recipient_phone);
    const rEmail = (inv.recipient_email ?? '').toLowerCase().trim();
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
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  @Delete(':id')
  async delete(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
  ) {
    const { error } = await this.getClient()
      .from('invoices')
      .delete()
      .eq('id', id)
      .eq('user_id', req.user.id);
    if (error) throw new BadRequestException(error.message);
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

    const { error } = await this.getClient()
      .from('invoice_items')
      .delete()
      .eq('id', itemId)
      .eq('invoice_id', id);
    if (error) throw new BadRequestException(error.message);
    return { success: true };
  }
}
