import {
  BadRequestException,
  Body,
  Controller,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { SupabaseService } from '../supabase.service';
import { AuthGuard } from '../auth/auth.guard';

const EXPO_TOKEN_REGEX = /^(ExponentPushToken|ExpoPushToken)\[[-_a-zA-Z0-9]+\]$/;

@Controller('register-push-token')
@UseGuards(AuthGuard)
@Throttle({ default: { limit: 10, ttl: 60000 } }) // 10 requests per minute per user
export class PushTokensController {
  constructor(private supabase: SupabaseService) {}

  private getClient() {
    return this.supabase.getClient();
  }

  @Post()
  async register(
    @Request() req: { user: { id: string; email?: string; user_metadata?: { phone?: string } } },
    @Body() body: { token: string },
  ) {
    const raw = body?.token;
    if (!raw || typeof raw !== 'string') {
      throw new BadRequestException('token is required');
    }
    const token = raw.trim();
    if (!token) {
      throw new BadRequestException('token is required');
    }
    if (!EXPO_TOKEN_REGEX.test(token)) {
      throw new BadRequestException('Invalid Expo push token format');
    }

    const meta = req.user?.user_metadata ?? {};
    const phone = meta?.phone
      ? String(meta.phone).replace(/\D/g, '').slice(-10)
      : null;

    const client = this.getClient();
    const now = new Date().toISOString();

    const { data: existing } = await client
      .from('push_tokens')
      .select('id, user_id')
      .eq('token', token)
      .maybeSingle();

    if (existing) {
      if (existing.user_id !== req.user.id) {
        await client.from('push_tokens').delete().eq('token', token);
      }
      const { error } = await client
        .from('push_tokens')
        .update({
          user_id: req.user.id,
          phone: phone || null,
          last_used: now,
          updated_at: now,
        })
        .eq('token', token);
      if (error) throw new BadRequestException(error.message);
    } else {
      const { error } = await client.from('push_tokens').insert({
        user_id: req.user.id,
        token,
        phone: phone || null,
        last_used: now,
        updated_at: now,
      });
      if (error) {
        if (error.code === '23505') {
          const { error: updErr } = await client
            .from('push_tokens')
            .update({
              user_id: req.user.id,
              phone: phone || null,
              last_used: now,
              updated_at: now,
            })
            .eq('token', token);
          if (updErr) throw new BadRequestException(updErr.message);
        } else {
          throw new BadRequestException(error.message);
        }
      }
    }

    return { success: true };
  }
}
