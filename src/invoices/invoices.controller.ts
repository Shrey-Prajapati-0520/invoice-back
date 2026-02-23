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

  @Get()
  async list(@Request() req: { user: { id: string } }) {
    const { data, error } = await this.getClient()
      .from('invoices')
      .select(
        `
        *,
        customers (id, name, phone, email)
      `,
      )
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
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
    const invoicePayload = {
      user_id: req.user.id,
      customer_id: body.customer_id || null,
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
      // Non-fatal; invoice was created successfully
    }

    // Receiver notification: send email to customer if they have an email
    if (customerEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) {
      try {
        const { data: profile } = await this.getClient()
          .from('profiles')
          .select('full_name')
          .eq('id', req.user.id)
          .single();
        const senderName = (profile as { full_name?: string } | null)?.full_name ?? 'InvoiceBill User';
        const items = resolved?.invoice_items ?? [];
        const total = items.reduce(
          (sum: number, it: { qty?: number; rate?: number }) =>
            sum + (Number(it.qty) || 0) * (Number(it.rate) || 0),
          0,
        );
        const amountStr = total > 0 ? `₹${total.toLocaleString('en-IN')}` : undefined;
        await this.mail.sendInvoiceNotificationToReceiver({
          to: customerEmail,
          senderName,
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
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
  ) {
    const { data, error } = await this.getClient()
      .from('invoices')
      .select(
        `
        *,
        customers (id, name, phone, email),
        invoice_items (*)
      `,
      )
      .eq('id', id)
      .eq('user_id', req.user.id)
      .single();
    if (error) throw new NotFoundException(error.message);
    return data;
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
