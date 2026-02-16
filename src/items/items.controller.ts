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

@Controller('items')
@UseGuards(AuthGuard)
export class ItemsController {
  constructor(private supabase: SupabaseService) {}

  @Get()
  async list(@Request() req: { user: { id: string } }) {
    const { data, error } = await this.supabase
      .getClient()
      .from('items')
      .select('*')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  @Post()
  async create(
    @Request() req: { user: { id: string } },
    @Body() body: { name: string; rate?: number; description?: string },
  ) {
    if (!body?.name?.trim()) {
      throw new BadRequestException('Name is required');
    }
    const rate = typeof body.rate === 'number' ? body.rate : parseFloat(String(body.rate || 0)) || 0;
    const { data, error } = await this.supabase
      .getClient()
      .from('items')
      .insert({
        user_id: req.user.id,
        name: body.name.trim(),
        rate,
        description: body.description?.trim() || null,
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
      .from('items')
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
    @Body() body: Partial<{ name: string; rate: number; description: string }>,
  ) {
    const { data, error } = await this.supabase
      .getClient()
      .from('items')
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
      .from('items')
      .delete()
      .eq('id', id)
      .eq('user_id', req.user.id);
    if (error) throw new BadRequestException(error.message);
    return { success: true };
  }
}
