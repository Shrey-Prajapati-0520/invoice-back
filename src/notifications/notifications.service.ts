import { Injectable, NotFoundException } from '@nestjs/common';
import {
  NotificationsRepository,
  CreateNotificationInput,
  NotificationRow,
} from './notifications.repository';

@Injectable()
export class NotificationsService {
  constructor(private repo: NotificationsRepository) {}

  async list(
    userId: string,
    options: { limit?: number; offset?: number } = {},
  ): Promise<{ notifications: NotificationRow[]; unread_count: number }> {
    const notifications = await this.repo.findByUserId(userId, options);
    const unread_count = await this.repo.getUnreadCount(userId);
    return { notifications, unread_count };
  }

  async getUnreadCount(userId: string): Promise<number> {
    return this.repo.getUnreadCount(userId);
  }

  async create(input: CreateNotificationInput): Promise<NotificationRow | null> {
    return this.repo.create(input);
  }

  async markRead(userId: string, notificationId: string): Promise<boolean> {
    const ok = await this.repo.markRead(userId, notificationId);
    if (!ok) throw new NotFoundException('Notification not found');
    return true;
  }

  async markAllRead(userId: string): Promise<{ marked: number }> {
    const marked = await this.repo.markAllRead(userId);
    return { marked };
  }

  async getById(userId: string, notificationId: string): Promise<NotificationRow | null> {
    return this.repo.findById(userId, notificationId);
  }
}
