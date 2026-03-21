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
import { SupabaseService } from '../supabase.service';
import { AuthGuard } from '../auth/auth.guard';
import { phoneForStorage, emailForStorage } from '../recipient.util';
import { CreateCustomerDto, UpdateCustomerDto } from '../common/dto/customer.dto';
import { ParseUUIDPipe } from '@nestjs/common';

@Controller('customers')
@UseGuards(AuthGuard)
export class CustomersController {
  private readonly logger = new Logger(CustomersController.name);

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
    const list = data ?? [];
    this.logger.log(`GET /customers user=${req.user.id} count=${list.length}`);
    return list;
  }

  @Post()
  async create(@Request() req: { user: { id: string } }, @Body() body: CreateCustomerDto) {
    // Store only normalized phone (10 digits) so recipient matching works reliably
    const phoneNorm = phoneForStorage(body.phone) ?? null;
    const emailNorm = emailForStorage(body.email) ?? null;
    const payload = {
      user_id: req.user.id,
      name: body.name,
      phone: phoneNorm,
      email: emailNorm,
      initials: body.initials ?? null,
      color: body.color ?? 'blue',
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
    @Param('id', ParseUUIDPipe) id: string,
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
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateCustomerDto,
  ) {
    const updates: Record<string, unknown> = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.phone !== undefined) updates.phone = phoneForStorage(body.phone) ?? null;
    if (body.email !== undefined) updates.email = emailForStorage(body.email) || body.email?.trim() || null;
    if (body.initials !== undefined) updates.initials = body.initials ?? null;
    if (body.color !== undefined) updates.color = body.color ?? null;
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
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const { data, error } = await this.getClient()
      .from('customers')
      .delete()
      .eq('id', id)
      .eq('user_id', req.user.id)
      .select('id');
    if (error) throw new BadRequestException(error.message);
    if (!data?.length) throw new NotFoundException('Customer not found');
    return { success: true };
  }
}
