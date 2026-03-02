import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase.service';

export type NotificationType = 'invoice' | 'quotation' | 'recurring' | 'system' | 'payment';

export interface CreateNotificationInput {
  user_id: string;
  user_phone?: string | null;
  title: string;
  body?: string | null;
  type: NotificationType;
  reference_id?: string | null;
  deep_link_screen?: string;
}

export interface NotificationRow {
  id: string;
  user_id: string;
  user_phone: string | null;
  title: string;
  body: string | null;
  type: NotificationType;
  reference_id: string | null;
  deep_link_screen: string;
  is_read: boolean;
  created_at: string;
}

@Injectable()
export class NotificationsRepository {
  constructor(private supabase: SupabaseService) {}

  private getClient() {
    return this.supabase.getClient();
  }

  async findByUserId(
    userId: string,
    options: { limit?: number; offset?: number } = {},
  ): Promise<NotificationRow[]> {
    const { limit = 20, offset = 0 } = options;
    const { data, error } = await this.getClient()
      .from('notifications')
      .select('id, user_id, user_phone, title, body, type, reference_id, deep_link_screen, is_read, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) return [];
    return (data ?? []) as NotificationRow[];
  }

  async getUnreadCount(userId: string): Promise<number> {
    const { count, error } = await this.getClient()
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('is_read', false);
    if (error) return 0;
    return count ?? 0;
  }

  /** Insert notification. Unique index (user_id, type, reference_id) prevents duplicates. */
  async create(input: CreateNotificationInput): Promise<NotificationRow | null> {
    const payload = {
      user_id: input.user_id,
      user_phone: input.user_phone ?? null,
      title: input.title,
      body: input.body ?? null,
      type: input.type,
      reference_id: input.reference_id ?? null,
      deep_link_screen: input.deep_link_screen ?? 'invoices',
      is_read: false,
    };
    const { data, error } = await this.getClient()
      .from('notifications')
      .insert(payload)
      .select()
      .single();
    if (error) {
      if (error.code === '23505') return null; // Duplicate (unique index) – skip
      return null;
    }
    return data as NotificationRow;
  }

  async markRead(userId: string, notificationId: string): Promise<boolean> {
    const { error } = await this.getClient()
      .from('notifications')
      .update({ is_read: true })
      .eq('id', notificationId)
      .eq('user_id', userId);
    return !error;
  }

  async markAllRead(userId: string): Promise<number> {
    const { data, error } = await this.getClient()
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', userId)
      .eq('is_read', false)
      .select('id');
    if (error) return 0;
    return (data ?? []).length;
  }

  async findById(userId: string, notificationId: string): Promise<NotificationRow | null> {
    const { data, error } = await this.getClient()
      .from('notifications')
      .select('*')
      .eq('id', notificationId)
      .eq('user_id', userId)
      .single();
    if (error || !data) return null;
    return data as NotificationRow;
  }
}
