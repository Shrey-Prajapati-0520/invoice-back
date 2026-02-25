import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Expo from 'expo-server-sdk';

@Injectable()
export class PushService {
  private client: Expo | null = null;

  constructor(private config: ConfigService) {
    const accessToken = this.config.get<string>('EXPO_ACCESS_TOKEN');
    this.client = new Expo(accessToken ? { accessToken } : {});
  }

  async send(to: string, title: string, body: string, data?: Record<string, unknown>): Promise<void> {
    if (!this.client) return;
    if (!Expo.isExpoPushToken(to)) return;

    const messages = [{ to, title, body, sound: 'default' as const, data }];
    const chunks = this.client.chunkPushNotifications(messages);
    for (const chunk of chunks) {
      try {
        await this.client.sendPushNotificationsAsync(chunk);
      } catch (err) {
        console.error('[Push] Send failed:', err);
      }
    }
  }

  async sendMany(
    recipients: Array<{ token: string; title: string; body: string; data?: Record<string, unknown> }>,
  ): Promise<void> {
    if (!this.client || recipients.length === 0) return;

    const messages = recipients
      .filter((r) => r.token && Expo.isExpoPushToken(r.token))
      .map((r) => ({ to: r.token, title: r.title, body: r.body, sound: 'default' as const, data: r.data }));
    if (messages.length === 0) return;

    const chunks = this.client.chunkPushNotifications(messages);
    for (const chunk of chunks) {
      try {
        await this.client.sendPushNotificationsAsync(chunk);
      } catch (err) {
        console.error('[Push] Send many failed:', err);
      }
    }
  }
}
