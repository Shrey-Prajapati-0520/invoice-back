import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type ExpoClient = InstanceType<Awaited<typeof import('expo-server-sdk')>['default']>;

@Injectable()
export class PushService {
  private client: ExpoClient | null = null;
  private clientPromise: Promise<ExpoClient> | null = null;

  constructor(private config: ConfigService) {}

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
    return /^ExponentPushToken\[.+\]$/.test(token);
  }

  async send(to: string, title: string, body: string, data?: Record<string, unknown>): Promise<void> {
    const client = await this.getClient();
    if (!client) return;
    if (!this.isExpoPushToken(to)) return;

    const messages = [{ to, title, body, sound: 'default' as const, data }];
    const chunks = client.chunkPushNotifications(messages);
    for (const chunk of chunks) {
      try {
        await client.sendPushNotificationsAsync(chunk);
      } catch (err) {
        console.error('[Push] Send failed:', err);
      }
    }
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
        await client.sendPushNotificationsAsync(chunk);
      } catch (err) {
        console.error('[Push] Send many failed:', err);
      }
    }
  }
}
