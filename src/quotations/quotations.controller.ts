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

  @Get()
  async list(@Request() req: { user: { id: string } }) {
    const { data, error } = await this.getClient()
      .from('quotations')
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
    const payload = {
      user_id: req.user.id,
      customer_id: body.customer_id || null,
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
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
  ) {
    const { data, error } = await this.getClient()
      .from('quotations')
      .select(
        `
        *,
        customers (id, name, phone, email),
        quotation_items (*)
      `,
      )
      .eq('id', id)
      .eq('user_id', req.user.id)
      .single();
    if (error) throw new NotFoundException(error.message);
    return data;
  }
}
