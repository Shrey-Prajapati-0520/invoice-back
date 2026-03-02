import { Controller, Get, Patch, Param, Query, Request, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthGuard } from '../auth/auth.guard';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
@UseGuards(AuthGuard)
@Throttle({ default: { limit: 60, ttl: 60000 } }) // 60/min
export class NotificationsController {
  constructor(private notifications: NotificationsService) {}

  @Get()
  async list(
    @Request() req: { user: { id: string } },
    @Query('limit') limitStr?: string,
    @Query('offset') offsetStr?: string,
  ) {
    const limit = Math.min(Math.max(1, parseInt(limitStr ?? '20', 10) || 20), 50);
    const offset = Math.max(0, parseInt(offsetStr ?? '0', 10) || 0);
    return this.notifications.list(req.user.id, { limit, offset });
  }

  @Get('unread-count')
  async unreadCount(@Request() req: { user: { id: string } }) {
    const count = await this.notifications.getUnreadCount(req.user.id);
    return { count };
  }

  @Patch('read/:id')
  async markRead(
    @Request() req: { user: { id: string } },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.notifications.markRead(req.user.id, id);
    return { success: true };
  }

  @Patch('read-all')
  async markAllRead(@Request() req: { user: { id: string } }) {
    const { marked } = await this.notifications.markAllRead(req.user.id);
    return { success: true, marked };
  }
}
