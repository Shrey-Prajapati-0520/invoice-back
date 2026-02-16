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
import { AuthGuard } from '../auth/auth.guard';

@Controller('bank-accounts')
@UseGuards(AuthGuard)
export class BankAccountsController {
  constructor(private supabase: SupabaseService) {}

  @Get()
  async list(@Request() req: { user: { id: string } }) {
    const { data, error } = await this.supabase
      .getClient()
      .from('bank_accounts')
      .select('*')
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
      account_holder: string;
      account_number_last4?: string;
      ifsc: string;
      bank_name?: string;
      branch_name?: string;
      is_default?: boolean;
    },
  ) {
    if (!body?.account_holder?.trim()) {
      throw new BadRequestException('Account holder name is required');
    }
    if (!body?.ifsc?.trim()) {
      throw new BadRequestException('IFSC code is required');
    }
    const last4 = body.account_number_last4?.replace(/\D/g, '').slice(-4) || null;
    const { data, error } = await this.supabase
      .getClient()
      .from('bank_accounts')
      .insert({
        user_id: req.user.id,
        account_holder: body.account_holder.trim(),
        account_number_last4: last4,
        ifsc: body.ifsc.trim(),
        bank_name: body.bank_name?.trim() || null,
        branch_name: body.branch_name?.trim() || null,
        is_default: body.is_default ?? false,
      })
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  @Get(':id')
  async get(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
  ) {
    const { data, error } = await this.supabase
      .getClient()
      .from('bank_accounts')
      .select('*')
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
      account_holder: string;
      account_number_last4: string;
      ifsc: string;
      bank_name: string;
      branch_name: string;
      is_default: boolean;
    }>,
  ) {
    const { data, error } = await this.supabase
      .getClient()
      .from('bank_accounts')
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
    const { error } = await this.supabase
      .getClient()
      .from('bank_accounts')
      .delete()
      .eq('id', id)
      .eq('user_id', req.user.id);
    if (error) throw new BadRequestException(error.message);
    return { success: true };
  }
}
