import {
  BadRequestException,
  Body,
  Controller,
  Logger,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';
import { SupabaseService } from '../supabase.service';
import { MailService } from '../mail/mail.service';
import { phoneForStorage } from '../recipient.util';

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private supabase: SupabaseService,
    private config: ConfigService,
    private mail: MailService,
  ) {}

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
      this.logger.warn(`Signup failed for ${email}: ${msg}`);
      if (msg.toLowerCase().includes('database error saving new user')) {
        throw new BadRequestException(
          'Account creation failed. Please try again. If the problem persists, contact support.',
        );
      }
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

  @Post('forgot-password')
  async forgotPassword(@Body() body: { email: string }) {
    const email = (body?.email?.trim?.() || '').toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new BadRequestException('Valid email is required');
    }
    const { data: users } = await this.supabase.getClient().auth.admin.listUsers({ perPage: 1000 });
    const user = users?.users?.find((u: { email?: string }) => (u.email || '').toLowerCase() === email);
    if (!user) {
      return { success: true, message: 'If an account exists, a 6-digit code has been sent to your email.' };
    }
    const otp = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await this.supabase
      .getClient()
      .from('password_reset_otps')
      .insert({ email, otp, expires_at: expiresAt });
    try {
      await this.mail.sendPasswordResetOtp({ to: email, otp });
    } catch (e) {
      this.logger.warn(`Failed to send OTP email to ${email}: ${e}`);
      throw new BadRequestException('Failed to send verification code. Please try again.');
    }
    return { success: true, message: 'A 6-digit code has been sent to your email. It expires in 60 minutes.' };
  }

  @Post('verify-reset-otp')
  async verifyResetOtp(@Body() body: { email: string; otp: string }) {
    const email = (body?.email?.trim?.() || '').toLowerCase();
    const otp = body?.otp?.trim?.() || '';
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new BadRequestException('Valid email is required');
    }
    if (!/^\d{6}$/.test(otp)) {
      throw new BadRequestException('Please enter the 6-digit code from your email.');
    }
    const { data: row } = await this.supabase
      .getClient()
      .from('password_reset_otps')
      .select('id')
      .eq('email', email)
      .eq('otp', otp)
      .gte('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!row) {
      throw new UnauthorizedException('Invalid or expired code. Please request a new one.');
    }
    const secret = this.config.get<string>('JWT_SECRET') || this.config.get<string>('SUPABASE_SERVICE_ROLE_KEY') || 'reset-secret';
    const resetToken = jwt.sign({ email, purpose: 'password-reset' }, secret, { expiresIn: '10m' });
    return { reset_token: resetToken };
  }

  @Post('reset-password-with-otp')
  async resetPasswordWithOtp(@Body() body: { reset_token: string; new_password: string }) {
    const resetToken = body?.reset_token?.trim?.();
    const newPassword = body?.new_password?.trim?.();
    if (!resetToken || !newPassword) {
      throw new BadRequestException('Session expired. Please start the reset process again.');
    }
    if (newPassword.length < 6) {
      throw new BadRequestException('Password must be at least 6 characters');
    }
    const secret = this.config.get<string>('JWT_SECRET') || this.config.get<string>('SUPABASE_SERVICE_ROLE_KEY') || 'reset-secret';
    let payload: { email?: string; purpose?: string };
    try {
      payload = jwt.verify(resetToken, secret) as { email?: string; purpose?: string };
    } catch {
      throw new UnauthorizedException('Session expired. Please start the reset process again.');
    }
    if (payload?.purpose !== 'password-reset' || !payload?.email) {
      throw new UnauthorizedException('Invalid session. Please start the reset process again.');
    }
    const email = payload.email.toLowerCase();
    const { data: users } = await this.supabase.getClient().auth.admin.listUsers({ perPage: 1000 });
    const user = users?.users?.find((u: { email?: string }) => (u.email || '').toLowerCase() === email);
    if (!user) {
      throw new UnauthorizedException('Account not found. Please sign up.');
    }
    const { error } = await this.supabase.getClient().auth.admin.updateUserById(user.id, {
      password: newPassword,
    });
    if (error) throw new BadRequestException(error.message);
    return { success: true };
  }

  @Post('reset-password')
  async resetPassword(@Body() body: { access_token: string; new_password: string }) {
    const token = body?.access_token?.trim?.();
    const newPassword = body?.new_password?.trim?.();
    if (!token || !newPassword) {
      throw new BadRequestException('Token and new password are required');
    }
    if (newPassword.length < 6) {
      throw new BadRequestException('Password must be at least 6 characters');
    }
    const { data: { user }, error: getUserError } = await this.supabase.getClient().auth.getUser(token);
    if (getUserError || !user) {
      throw new UnauthorizedException('Invalid or expired reset link. Please request a new one.');
    }
    const { error } = await this.supabase.getClient().auth.admin.updateUserById(user.id, {
      password: newPassword,
    });
    if (error) throw new UnauthorizedException(error.message);
    return { success: true };
  }
}
