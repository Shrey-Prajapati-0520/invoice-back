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

@Controller('terms')
@UseGuards(AuthGuard)
export class TermsController {
  constructor(private readonly supabase: SupabaseService) {}

  private getClient() {
    return this.supabase.getClient();
  }

  @Get()
  async list(@Request() req: { user: { id: string } }) {
    const { data, error } = await this.getClient()
      .from('terms')
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
      title: string;
      content: string;
      category?: string;
      is_default?: boolean;
    },
  ) {
    const title = body?.title?.trim();
    const content = body?.content?.trim();
    if (!title || title.length < 3) {
      throw new BadRequestException('Title must be at least 3 characters');
    }
    if (!content || content.length < 10) {
      throw new BadRequestException('Content must be at least 10 characters');
    }
    const { data, error } = await this.getClient()
      .from('terms')
      .insert({
        user_id: req.user.id,
        title,
        content,
        category: body.category?.trim() || null,
        is_default: !!body.is_default,
        is_custom: true,
      })
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  @Patch(':id')
  async update(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
    @Body()
    body: Partial<{
      title: string;
      content: string;
      category: string;
      is_default: boolean;
    }>,
  ) {
    const payload: Record<string, unknown> = {};
    if (body.title != null) {
      const t = body.title.trim();
      if (t.length < 3) throw new BadRequestException('Title must be at least 3 characters');
      payload.title = t;
    }
    if (body.content != null) {
      const c = body.content.trim();
      if (c.length < 10) throw new BadRequestException('Content must be at least 10 characters');
      payload.content = c;
    }
    if (body.category != null) payload.category = body.category.trim() || null;
    if (body.is_default != null) payload.is_default = !!body.is_default;

    if (Object.keys(payload).length === 0) {
      const { data } = await this.getClient()
        .from('terms')
        .select('*')
        .eq('id', id)
        .eq('user_id', req.user.id)
        .single();
      if (!data) throw new BadRequestException('Term not found');
      return data;
    }

    const { data, error } = await this.getClient()
      .from('terms')
      .update(payload)
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
    const { data, error } = await this.getClient()
      .from('terms')
      .delete()
      .eq('id', id)
      .eq('user_id', req.user.id)
      .select('id');
    if (error) throw new BadRequestException(error.message);
    if (!data?.length) throw new NotFoundException('Term not found');
    return { success: true };
  }
}
