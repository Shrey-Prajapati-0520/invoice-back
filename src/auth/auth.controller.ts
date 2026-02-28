import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase.service';
import { phoneForStorage } from '../recipient.util';

@Controller('auth')
export class AuthController {
  constructor(private supabase: SupabaseService) {}

  @Post('register')
  async register(
    @Body() body: { email: string; password: string; full_name?: string; phone?: string },
  ) {
    const email = body?.email?.trim?.();
    if (!email) throw new BadRequestException('Email is required');
    if (!body?.password || body.password.length < 6) {
      throw new BadRequestException('Password must be at least 6 characters');
    }
    const phone = body?.phone?.trim?.().replace(/\D/g, '') || undefined;
    if (!phone || phone.length < 10 || !/^[6-9]\d{9}$/.test(phone.slice(-10))) {
      throw new BadRequestException('Please enter a valid 10-digit Indian mobile number');
    }
    const phoneNorm = phoneForStorage(phone) || phone.replace(/\D/g, '').slice(-10);

    // One phone = one account: reject if phone already registered
    const { data: existingProfile } = await this.supabase
      .getClient()
      .from('profiles')
      .select('id')
      .eq('phone', phoneNorm)
      .maybeSingle();
    if (existingProfile) {
      throw new BadRequestException('This phone number is already registered. Each number can only be used for one account.');
    }

    try {
      const { data, error } = await this.supabase.getClient().auth.signUp({
        email,
        password: body.password,
        options: {
          data: {
            full_name: body.full_name?.trim?.(),
            phone: phone || body.phone?.trim?.(),
          },
        },
      });
      if (error) throw new BadRequestException(error.message);
      // Auto-confirm email so user can use app immediately without email verification
      if (data.user) {
        await this.supabase.getClient().auth.admin.updateUserById(data.user.id, {
          email_confirm: true,
        });
        // Upsert profile so My Profile shows create-account data (guarantees data even if trigger fails)
        const fullName = body.full_name?.trim() || null;
        const phoneNorm = phone ? phone.replace(/\D/g, '').slice(-10) || null : null;
        const emailVal = data.user.email?.trim() || null;
        try {
          await this.supabase
            .getClient()
            .from('profiles')
            .upsert(
              {
                id: data.user.id,
                full_name: fullName,
                email: emailVal,
                phone: phoneNorm,
              },
              { onConflict: 'id' },
            )
            .select()
            .single();
        } catch {
          /* non-fatal */
        }
      }
      // signUp returns session: null when email confirmation is enabled; we confirmed above, so sign in to get a session
      let session = data.session;
      if (!session?.access_token && data.user) {
        const signIn = await this.supabase.getClient().auth.signInWithPassword({
          email,
          password: body.password,
        });
        if (!signIn.error && signIn.data?.session) {
          session = signIn.data.session;
        }
      }
      return { user: data.user, session };
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
      const msg = e instanceof Error ? e.message : 'Registration failed. Please try again.';
      throw new BadRequestException(msg);
    }
  }

  @Post('login')
  async login(@Body() body: { email: string; password: string }) {
    const email = body?.email?.trim?.();
    if (!email || !body?.password) {
      throw new BadRequestException('Email and password are required');
    }
    try {
      let { data, error } = await this.supabase
        .getClient()
        .auth.signInWithPassword({ email, password: body.password });
      if (error?.message?.toLowerCase().includes('email not confirmed')) {
        const { data: users } = await this.supabase.getClient().auth.admin.listUsers({ perPage: 1000 });
        const user = users?.users?.find((u: { email?: string }) => u.email?.toLowerCase() === email);
        if (user) {
          await this.supabase.getClient().auth.admin.updateUserById(user.id, { email_confirm: true });
          const retry = await this.supabase.getClient().auth.signInWithPassword({ email, password: body.password });
          if (!retry.error) {
            return { user: retry.data.user, session: retry.data.session };
          }
        }
      }
      if (error) throw new UnauthorizedException(error.message);
      return { user: data.user, session: data.session };
    } catch (e) {
      if (e instanceof UnauthorizedException) throw e;
      const msg = e instanceof Error ? e.message : 'Sign in failed. Please check your credentials.';
      throw new UnauthorizedException(msg);
    }
  }

  @Post('logout')
  async logout() {
    await this.supabase.getClient().auth.signOut({ scope: 'local' });
    return { success: true };
  }

  @Post('refresh')
  async refresh(@Body() body: { refresh_token: string }) {
    const { data, error } = await this.supabase
      .getClient()
      .auth.refreshSession({ refresh_token: body.refresh_token });
    if (error) throw new UnauthorizedException(error.message);
    return { session: data.session };
  }
}
