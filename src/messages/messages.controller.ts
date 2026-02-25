import { Controller, Get, Request, UseGuards } from '@nestjs/common';
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
}
