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
import { CreateItemDto, UpdateItemDto } from '../common/dto/item.dto';
import { ParseUUIDPipe } from '@nestjs/common';

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
  async create(@Request() req: { user: { id: string } }, @Body() body: CreateItemDto) {
    const rate = body.rate ?? 0;
    const { data, error } = await this.supabase
      .getClient()
      .from('items')
      .insert({
        user_id: req.user.id,
        name: body.name,
        rate,
        description: body.description ?? null,
      })
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
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateItemDto,
  ) {
    const updates: Record<string, unknown> = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.rate !== undefined) updates.rate = body.rate;
    if (body.description !== undefined) updates.description = body.description ?? null;
    if (Object.keys(updates).length === 0) {
      const { data: existing } = await this.supabase.getClient().from('items')
        .select('*').eq('id', id).eq('user_id', req.user.id).single();
      if (!existing) throw new NotFoundException('Item not found');
      return existing;
    }
    const { data, error } = await this.supabase
      .getClient()
      .from('items')
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
    const { data, error } = await this.supabase
      .getClient()
      .from('items')
      .delete()
      .eq('id', id)
      .eq('user_id', req.user.id)
      .select('id');
    if (error) throw new BadRequestException(error.message);
    if (!data?.length) throw new NotFoundException('Item not found');
    return { success: true };
  }
}
