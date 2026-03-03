import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { SupabaseService } from '../supabase.service';
import { AuthGuard } from '../auth/auth.guard';

interface InvoiceSettingsRow {
  id?: string;
  user_id?: string;
  target: string;
  format_type?: string;
  selected_template?: string;
  starting_number?: string;
  reset_option?: string;
  padding?: number;
  duplicate_check?: string;
  manual_override?: boolean;
  skip_deleted?: boolean;
  custom_components?: unknown;
}

@Controller('invoice-settings')
@UseGuards(AuthGuard)
export class InvoiceSettingsController {
  constructor(private readonly supabase: SupabaseService) {}

  private getClient() {
    return this.supabase.getClient();
  }

  @Get()
  async get(
    @Request() req: { user: { id: string } },
    @Query('target') target?: string,
  ) {
    let query = this.getClient()
      .from('invoice_settings')
      .select('*')
      .eq('user_id', req.user.id);
    if (target && ['invoices', 'quotes'].includes(target)) {
      query = query.eq('target', target);
    }
    const { data, error } = await query;
    if (error) throw new BadRequestException(error.message);
    if (target) return (data && data[0]) ?? null;
    return data ?? [];
  }

  @Get('next-number')
  async getNextNumber(
    @Request() req: { user: { id: string } },
    @Query('target') target: string,
  ) {
    if (!target || !['invoices', 'quotes'].includes(target)) {
      throw new BadRequestException('target must be invoices or quotes');
    }
    const client = this.getClient();

    const { data: settings } = await client
      .from('invoice_settings')
      .select('*')
      .eq('user_id', req.user.id)
      .eq('target', target)
      .single();

    const table = target === 'invoices' ? 'invoices' : 'quotations';
    const numCol = target === 'invoices' ? 'number' : 'quo_number';
    const prefix = target === 'invoices' ? 'INV' : 'QUO';

    const { data: rows } = await client
      .from(table)
      .select(numCol)
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false })
      .limit(1);

    const lastRow = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
    const lastNum = lastRow ? (lastRow as Record<string, string>)[numCol] : null;
    const match = lastNum ? lastNum.match(/(\d+)\s*$/) : null;
    const lastSeq = match ? parseInt(match[1], 10) : 0;

    const start = settings?.starting_number ? parseInt(String(settings.starting_number).replace(/\D/g, ''), 10) || 1 : 1;
    const padding = settings?.padding ?? 3;
    const template = settings?.selected_template ?? 'year-seq';
    const seq = Math.max(lastSeq, start) + 1;
    const padded = seq.toString().padStart(padding, '0');

    const now = new Date();
    const year = now.getFullYear();
    const yearShort = year.toString().slice(-2);
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const monthName = now.toLocaleString('default', { month: 'short' }).toUpperCase();
    const day = now.getDate().toString().padStart(2, '0');
    const fyShort = now.getMonth() >= 2 ? `FY${parseInt(yearShort, 10) + 1}` : `FY${yearShort}`;

    let number: string;
    switch (template) {
      case 'seq':
        number = `${prefix}-${padded}`;
        break;
      case 'year-seq':
        number = `${prefix}-${year}-${padded}`;
        break;
      case 'month-year-seq':
        number = `${prefix}-${monthName}${yearShort}-${padded}`;
        break;
      case 'fy-seq':
        number = `${prefix}-${fyShort}-${padded}`;
        break;
      case 'date-seq':
        number = `${prefix}-${year}${month}${day}-${padded}`;
        break;
      default:
        number = `${prefix}-${year}-${padded}`;
    }
    return { number };
  }

  @Post()
  async upsert(
    @Request() req: { user: { id: string } },
    @Body()
    body: {
      target: 'invoices' | 'quotes';
      format_type?: 'preset' | 'custom';
      selected_template?: string;
      starting_number?: string;
      reset_option?: string;
      padding?: number;
      duplicate_check?: string;
      manual_override?: boolean;
      skip_deleted?: boolean;
      custom_components?: unknown;
    },
  ) {
    const t = body.target;
    if (!t || !['invoices', 'quotes'].includes(t)) {
      throw new BadRequestException('target must be "invoices" or "quotes"');
    }
    const payload: Partial<InvoiceSettingsRow> = {
      user_id: req.user.id,
      target: t,
      format_type: body.format_type ?? 'preset',
      selected_template: body.selected_template?.trim() || undefined,
      starting_number: body.starting_number ?? '001',
      reset_option: body.reset_option ?? 'never',
      padding: body.padding ?? 3,
      duplicate_check: body.duplicate_check ?? 'error',
      manual_override: body.manual_override ?? false,
      skip_deleted: body.skip_deleted ?? true,
      custom_components: body.custom_components ?? [],
    };
    const { data, error } = await this.getClient()
      .from('invoice_settings')
      .upsert(payload, { onConflict: 'user_id,target' })
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }
}
