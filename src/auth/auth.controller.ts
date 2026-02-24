import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase.service';

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
    if (phone && (phone.length < 10 || !/^[6-9]\d{9}$/.test(phone))) {
      throw new BadRequestException('Please enter a valid 10-digit Indian mobile number');
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
      // Auto-confirm email so user can login immediately
      if (data.user) {
        await this.supabase.getClient().auth.admin.updateUserById(data.user.id, {
          email_confirm: true,
        });
      }
      return { user: data.user, session: data.session };
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
        const user = users?.users?.find((u) => u.email?.toLowerCase() === email);
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
