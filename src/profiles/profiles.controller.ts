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
import { UpdateProfileDto } from '../common/dto/profile.dto';
import { isAllowedImageType, MAX_AVATAR_BYTES } from '../common/validation/sanitize.util';
import { stripNullBytes } from '../common/validation/sanitize.util';

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
    let { data: profile, error } = await this.getClient()
      .from('profiles')
      .select('id, full_name, phone, email, avatar_url, pincode')
      .eq('id', req.user.id)
      .single();

    if (error && error.code !== 'PGRST116') {
      throw new BadRequestException(error.message);
    }

    // Ensure profile exists (handles race where handle_new_user hasn't run yet)
    if (!profile && error?.code === 'PGRST116') {
      const meta = req.user?.user_metadata ?? {};
      const initPhone = meta.phone && String(meta.phone).replace(/\D/g, '').length >= 10
        ? String(meta.phone).replace(/\D/g, '').slice(-10) : null;
      try {
        const { data: inserted } = await this.getClient()
          .from('profiles')
          .upsert(
            {
              id: req.user.id,
              full_name: meta?.full_name ?? null,
              email: (req.user as { email?: string }).email ?? null,
              phone: initPhone,
            },
            { onConflict: 'id' },
          )
          .select('id, full_name, phone, email, avatar_url, pincode')
          .single();
        if (inserted) profile = inserted;
      } catch {
        /* non-fatal; continue with merged response */
      }
    }

    const meta = req.user?.user_metadata ?? {};
    const metaPhone = meta.phone ? String(meta.phone).replace(/\D/g, '').slice(-10) : null;

    // Sync phone from auth to profile so User B can be found when receiving invoices/quotations
    const storedPhone = (profile as { phone?: string } | null)?.phone;
    if (!storedPhone && metaPhone && metaPhone.length >= 10) {
      try {
        await this.getClient()
          .from('profiles')
          .update({ phone: metaPhone })
          .eq('id', req.user.id);
      } catch {
        /* non-fatal */
      }
    }

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
  async updateMe(@Request() req: { user: { id: string } }, @Body() body: UpdateProfileDto) {
    const updates: Record<string, string | null> = {};
    if (body.full_name !== undefined) updates.full_name = body.full_name || null;
    if (body.phone !== undefined) {
      const digits = body.phone ? String(body.phone).replace(/\D/g, '').slice(-10) : '';
      const newPhone = digits.length >= 10 ? digits : null;
      if (newPhone) {
        const { data: existing } = await this.getClient()
          .from('profiles')
          .select('id')
          .eq('phone', newPhone)
          .neq('id', req.user.id)
          .maybeSingle();
        if (existing) {
          throw new BadRequestException('This phone number is already registered to another account.');
        }
      }
      updates.phone = newPhone;
    }
    if (body.email !== undefined) updates.email = body.email || null;
    if (body.pincode !== undefined) updates.pincode = body.pincode || null;
    if (body.expo_push_token !== undefined) updates.expo_push_token = body.expo_push_token || null;

    if (Object.keys(updates).length === 0) {
      const { data } = await this.getClient()
        .from('profiles')
        .select('*')
        .eq('id', req.user.id)
        .single();
      return data;
    }

    let { data, error } = await this.getClient()
      .from('profiles')
      .update(updates)
      .eq('id', req.user.id)
      .select()
      .single();

    if (error) throw new BadRequestException(error.message);
    if (!data && body.expo_push_token !== undefined) {
      try {
        const meta = (req as { user?: { user_metadata?: { full_name?: string; phone?: string }; email?: string } }).user?.user_metadata ?? {};
        const initPhone = meta.phone && String(meta.phone).replace(/\D/g, '').length >= 10
          ? String(meta.phone).replace(/\D/g, '').slice(-10) : null;
        const { data: upserted } = await this.getClient()
          .from('profiles')
          .upsert(
            {
              id: req.user.id,
              full_name: meta?.full_name ?? null,
              email: (req.user as { email?: string }).email ?? null,
              phone: initPhone,
              expo_push_token: body.expo_push_token?.trim() || null,
            },
            { onConflict: 'id' },
          )
          .select()
          .single();
        data = upserted;
      } catch {
        /* non-fatal fallback */
      }
    }
    return data;
  }

  @Post('me/avatar')
  async uploadAvatar(
    @Request() req: { user: { id: string } },
    @Body() body: { imageBase64?: string },
  ) {
    const raw = stripNullBytes(String(body?.imageBase64 ?? '').trim());
    if (!raw) throw new BadRequestException('imageBase64 is required');

    const match = raw.match(/^data:image\/(\w+);base64,([A-Za-z0-9+/=]+)$/);
    if (!match) throw new BadRequestException('Invalid image format. Use data:image/png;base64,... or data:image/jpeg;base64,...');
    const ext = match[1].toLowerCase();
    if (!isAllowedImageType(ext)) {
      throw new BadRequestException('Only PNG, JPEG, JPG, and WebP images are allowed');
    }
    let buffer: Buffer;
    try {
      buffer = Buffer.from(match[2], 'base64');
    } catch {
      throw new BadRequestException('Invalid base64 data');
    }
    if (buffer.length > MAX_AVATAR_BYTES) {
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
      let msg = uploadError.message;
      if (msg?.toLowerCase?.().includes('bucket')) {
        msg = 'Storage bucket "avatars" not found. Create it in Supabase Dashboard → Storage. See docs/AVATAR_BUCKET_SETUP.md';
      } else if (msg?.toLowerCase?.().includes('row-level security') || msg?.toLowerCase?.().includes('rls')) {
        msg = 'Storage access denied. Run the migration: supabase/migrations/20260317000001_profiles_avatar_rls.sql in Supabase SQL Editor.';
      }
      throw new BadRequestException(msg);
    }

    const {
      data: { publicUrl },
    } = this.getClient().storage.from(AVATAR_BUCKET).getPublicUrl(path);
    // Cache-bust: same path = same URL, so add ?t= to force client to fetch new image on update
    const avatarUrl = `${publicUrl}${publicUrl.includes('?') ? '&' : '?'}t=${Date.now()}`;

    const { data: profile, error: updateError } = await this.getClient()
      .from('profiles')
      .update({ avatar_url: avatarUrl })
      .eq('id', req.user.id)
      .select()
      .single();

    if (updateError) {
      const msg = updateError.message?.toLowerCase?.().includes('row-level security') || updateError.message?.toLowerCase?.().includes('rls')
        ? 'Profile update denied. Run migration 20260317000001_profiles_avatar_rls.sql in Supabase SQL Editor. Ensure SUPABASE_SERVICE_KEY is set in backend .env.'
        : updateError.message;
      throw new BadRequestException(msg);
    }
    return profile;
  }
}
