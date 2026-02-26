import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { SupabaseService } from '../supabase.service';
import { AuthGuard } from '../auth/auth.guard';

const AVATAR_BUCKET = 'avatars';

@Controller('profiles')
@UseGuards(AuthGuard)
export class ProfilesController {
  constructor(private supabase: SupabaseService) {}

  private getClient() {
    return this.supabase.getClient();
  }

  @Get('me')
  async getMe(
    @Request()
    req: {
      user: { id: string; email?: string; user_metadata?: { full_name?: string; phone?: string } };
    },
  ) {
    const { data: profile, error } = await this.getClient()
      .from('profiles')
      .select('id, full_name, phone, email, avatar_url, pincode')
      .eq('id', req.user.id)
      .single();

    if (error && error.code !== 'PGRST116') {
      throw new BadRequestException(error.message);
    }

    const meta = req.user?.user_metadata ?? {};
    const metaPhone = meta.phone ? String(meta.phone).replace(/\D/g, '').slice(-10) : null;

    return {
      id: req.user.id,
      full_name: profile?.full_name ?? meta?.full_name ?? null,
      phone: profile?.phone ?? metaPhone ?? null,
      email: profile?.email ?? req.user.email ?? null,
      avatar_url: profile?.avatar_url ?? null,
      pincode: profile?.pincode ?? null,
    };
  }

  @Patch('me')
  async updateMe(
    @Request() req: { user: { id: string } },
    @Body()
    body: Partial<{ full_name: string; phone: string; email: string; pincode: string; expo_push_token: string }>,
  ) {
    const updates: Record<string, string | null> = {};
    if (body.full_name !== undefined) updates.full_name = body.full_name?.trim() || null;
    if (body.phone !== undefined) {
      const digits = body.phone?.trim()?.replace(/\D/g, '') || '';
      updates.phone = digits.length >= 10 ? digits.slice(-10) : null;
    }
    if (body.email !== undefined) updates.email = body.email?.trim() || null;
    if (body.pincode !== undefined) updates.pincode = body.pincode?.trim() || null;
    if (body.expo_push_token !== undefined) {
      updates.expo_push_token = body.expo_push_token?.trim() || null;
    }

    if (Object.keys(updates).length === 0) {
      const { data } = await this.getClient()
        .from('profiles')
        .select('*')
        .eq('id', req.user.id)
        .single();
      return data;
    }

    const { data, error } = await this.getClient()
      .from('profiles')
      .update(updates)
      .eq('id', req.user.id)
      .select()
      .single();

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  @Post('me/avatar')
  async uploadAvatar(
    @Request() req: { user: { id: string } },
    @Body() body: { imageBase64?: string },
  ) {
    const base64 = body?.imageBase64;
    if (!base64?.trim()) {
      throw new BadRequestException('imageBase64 is required');
    }

    const match = base64.match(/^data:image\/(\w+);base64,(.+)$/);
    const ext = match ? match[1] : 'jpg';
    const buffer = Buffer.from(match ? match[2] : base64, 'base64');

    if (buffer.length > 5 * 1024 * 1024) {
      throw new BadRequestException('Image must be less than 5MB');
    }

    const path = `${req.user.id}/avatar.${ext}`;

    try {
      const { data: buckets } = await this.getClient().storage.listBuckets();
      const hasBucket = buckets?.some((b) => b.name === AVATAR_BUCKET);
      if (!hasBucket) {
        await this.getClient().storage.createBucket(AVATAR_BUCKET, { public: true });
      }
    } catch {
      /* bucket may already exist */
    }

    const { error: uploadError } = await this.getClient().storage
      .from(AVATAR_BUCKET)
      .upload(path, buffer, {
        contentType: `image/${ext}`,
        upsert: true,
      });

    if (uploadError) {
      throw new BadRequestException(uploadError.message);
    }

    const {
      data: { publicUrl },
    } = this.getClient().storage.from(AVATAR_BUCKET).getPublicUrl(path);

    const { data: profile, error: updateError } = await this.getClient()
      .from('profiles')
      .update({ avatar_url: publicUrl })
      .eq('id', req.user.id)
      .select()
      .single();

    if (updateError) throw new BadRequestException(updateError.message);
    return profile;
  }
}
