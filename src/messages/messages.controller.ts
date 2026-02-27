import { Controller, Get, Patch, Request, UseGuards } from '@nestjs/common';
import { SupabaseService } from '../supabase.service';
import { AuthGuard } from '../auth/auth.guard';

@Controller('messages')
@UseGuards(AuthGuard)
export class MessagesController {
  constructor(private supabase: SupabaseService) {}

  private getClient() {
    return this.supabase.getClient();
  }

  @Get()
  async list(@Request() req: { user: { id: string } }) {
    const { data, error } = await this.getClient()
      .from('messages')
      .select('id, title, description, timestamp, icon, icon_color, unread, created_at')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });
    if (error) return [];
    return data ?? [];
  }

  @Get('unread-count')
  async unreadCount(@Request() req: { user: { id: string } }) {
    const { count, error } = await this.getClient()
      .from('messages')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', req.user.id)
      .eq('unread', true);
    if (error) return { count: 0 };
    return { count: count ?? 0 };
  }

  @Patch('mark-read')
  async markRead(@Request() req: { user: { id: string } }) {
    const { error } = await this.getClient()
      .from('messages')
      .update({ unread: false })
      .eq('user_id', req.user.id)
      .eq('unread', true);
    if (error) return { success: false };
    return { success: true };
  }
}
