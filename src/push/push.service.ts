import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../supabase.service';

type ExpoClient = InstanceType<Awaited<typeof import('expo-server-sdk')>['default']>;
type ExpoPushTicket = { status: 'ok' } | { status: 'error'; message: string; details?: { error?: string } };

@Injectable()
export class PushService {
  private client: ExpoClient | null = null;
  private clientPromise: Promise<ExpoClient> | null = null;

  constructor(
    private config: ConfigService,
    private supabase: SupabaseService,
  ) {}

  private async getClient(): Promise<ExpoClient | null> {
    if (this.client) return this.client;
    if (!this.clientPromise) {
      this.clientPromise = (async () => {
        const mod = await import('expo-server-sdk');
        const Expo = mod.default;
        const accessToken = this.config.get<string>('EXPO_ACCESS_TOKEN');
        return new Expo(accessToken ? { accessToken } : {});
      })();
    }
    this.client = await this.clientPromise;
    return this.client;
  }

  private isExpoPushToken(token: string): boolean {
    return /^(ExponentPushToken|ExpoPushToken)\[.+\]$/.test(token);
  }

  /** Get all push tokens for a user (push_tokens table + profiles.expo_push_token fallback) */
  async getTokensForUser(userId: string): Promise<string[]> {
    const db = this.supabase.getClient();
    const tokens = new Set<string>();

    const { data: fromTable } = await db
      .from('push_tokens')
      .select('token')
      .eq('user_id', userId);
    (fromTable ?? []).forEach((r: { token: string }) => tokens.add(r.token));

    const { data: profile } = await db
      .from('profiles')
      .select('expo_push_token')
      .eq('id', userId)
      .single();
    const legacy = (profile as { expo_push_token?: string } | null)?.expo_push_token;
    if (legacy && this.isExpoPushToken(legacy)) tokens.add(legacy);

    return Array.from(tokens);
  }

  private async removeInvalidToken(token: string): Promise<void> {
    try {
      await this.supabase.getClient().from('push_tokens').delete().eq('token', token);
      await this.supabase.getClient().from('profiles').update({ expo_push_token: null }).eq('expo_push_token', token);
    } catch (err) {
      if (err && typeof err === 'object' && 'code' in err) {
        /* PGRST116 = no rows; ignore */
      }
    }
  }

  async send(to: string, title: string, body: string, data?: Record<string, unknown>): Promise<void> {
    await this.sendMany([{ token: to, title, body, data }]);
  }

  async sendMany(
    recipients: Array<{ token: string; title: string; body: string; data?: Record<string, unknown> }>,
  ): Promise<void> {
    const client = await this.getClient();
    if (!client || recipients.length === 0) return;

    const messages = recipients
      .filter((r) => r.token && this.isExpoPushToken(r.token))
      .map((r) => ({ to: r.token, title: r.title, body: r.body, sound: 'default' as const, data: r.data }));
    if (messages.length === 0) return;

    const chunks = client.chunkPushNotifications(messages);
    for (const chunk of chunks) {
      try {
        const tickets = await client.sendPushNotificationsAsync(chunk) as ExpoPushTicket[];
        tickets.forEach((ticket, i) => {
          if (ticket.status === 'error' && (ticket as { details?: { error?: string } }).details?.error === 'DeviceNotRegistered') {
            const invalidToken = (chunk[i] as { to: string }).to;
            this.removeInvalidToken(invalidToken);
          }
        });
      } catch (err) {
        console.error('[Push] Send many failed:', err);
      }
    }
  }
}
