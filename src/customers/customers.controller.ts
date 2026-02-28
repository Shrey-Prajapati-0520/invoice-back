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
import { phoneForStorage, emailForStorage } from '../recipient.util';

@Controller('customers')
@UseGuards(AuthGuard)
export class CustomersController {
  constructor(private supabase: SupabaseService) {}

  private getClient() {
    return this.supabase.getClient();
  }

  @Get()
  async list(@Request() req: { user: { id: string } }) {
    const { data, error } = await this.getClient()
      .from('customers')
      .select('*')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  @Post()
  async create(
    @Request() req: { user: { id: string } },
    @Body() body: { name: string; phone?: string; email?: string; initials?: string; color?: string },
  ) {
    if (!body?.name?.trim()) {
      throw new BadRequestException('Name is required');
    }
    // Store only normalized phone (10 digits) so recipient matching works reliably
    const phoneNorm = phoneForStorage(body.phone) ?? null;
    const emailNorm = emailForStorage(body.email) ?? null;
    const payload = {
      user_id: req.user.id,
      name: body.name.trim(),
      phone: phoneNorm,
      email: emailNorm,
      initials: body.initials?.trim() || null,
      color: body.color || 'blue',
    };
    const { data, error } = await this.getClient()
      .from('customers')
      .insert(payload)
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
    const { data, error } = await this.getClient()
      .from('customers')
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
    @Body() body: Partial<{ name: string; phone: string; email: string; initials: string; color: string }>,
  ) {
    const updates: Record<string, unknown> = { ...body };
    if (body.phone !== undefined) {
      updates.phone = phoneForStorage(body.phone) ?? null;
    }
    if (body.email !== undefined) {
      updates.email = emailForStorage(body.email) || body.email?.trim() || null;
    }
    const { data, error } = await this.getClient()
      .from('customers')
      .update(updates)
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
      .from('customers')
      .delete()
      .eq('id', id)
      .eq('user_id', req.user.id);
    if (error) throw new BadRequestException(error.message);
    return { success: true };
  }
}
