import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase.service';
import { OtpService } from './otp.service';

@Controller('auth')
export class AuthController {
  constructor(
    private supabase: SupabaseService,
    private otp: OtpService,
  ) {}

  @Post('register')
  async register(
    @Body() body: { email: string; password: string; full_name?: string },
  ) {
    const email = body?.email?.trim?.();
    if (!email) throw new BadRequestException('Email is required');
    if (!body?.password || body.password.length < 6) {
      throw new BadRequestException('Password must be at least 6 characters');
    }
    try {
      const { data, error } = await this.supabase.getClient().auth.signUp({
        email,
        password: body.password,
        options: { data: { full_name: body.full_name?.trim?.() } },
      });
      if (error) throw new BadRequestException(error.message);
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
      const { data, error } =
        await this.supabase.getClient().auth.signInWithPassword({ email, password: body.password });
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

  @Post('send-otp')
  async sendOtp(@Body() body: { email: string }) {
    const email = body?.email?.trim?.();
    if (!email) throw new BadRequestException('Email is required');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new BadRequestException('Please enter a valid email address');
    }
    try {
      this.otp.cleanup();
      await this.otp.sendOtp(email);
      return { success: true, message: 'Verification code sent to your email' };
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to send verification code';
      throw new BadRequestException(msg);
    }
  }

  @Post('verify-otp')
  async verifyOtp(@Body() body: { email: string; code: string }) {
    const email = body?.email?.trim?.();
    const code = body?.code?.trim?.();
    if (!email || !code) {
      throw new BadRequestException('Email and code are required');
    }
    try {
      const resetToken = this.otp.verifyOtp(email, code);
      return { resetToken };
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Invalid or expired code. Please request a new one.';
      throw new BadRequestException(msg);
    }
  }

  @Post('login-with-otp')
  async loginWithOtp(@Body() body: { email: string; code: string }) {
    const email = body?.email?.trim?.().toLowerCase();
    const code = body?.code?.trim?.();
    if (!email || !code) {
      throw new BadRequestException('Email and code are required');
    }
    try {
      this.otp.verifyOtpOnly(email, code);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Invalid or expired code. Please request a new one.';
      throw new BadRequestException(msg);
    }
    try {
      const {
        data: linkData,
        error: linkError,
      } = await this.supabase.getClient().auth.admin.generateLink({
        type: 'magiclink',
        email,
      });
      if (linkError) throw new BadRequestException(linkError.message);
      const hashedToken = (linkData as { properties?: { hashed_token?: string } })?.properties?.hashed_token;
      if (!hashedToken) throw new BadRequestException('Failed to generate login link. User may not exist – create an account first.');
      const {
        data: sessionData,
        error: verifyError,
      } = await this.supabase.getClient().auth.verifyOtp({
        token_hash: hashedToken,
        type: 'email',
      });
      if (verifyError) throw new UnauthorizedException(verifyError.message);
      return { user: sessionData.user, session: sessionData.session };
    } catch (e) {
      if (e instanceof BadRequestException || e instanceof UnauthorizedException) throw e;
      const msg = e instanceof Error ? e.message : 'Login failed. Please try again.';
      throw new BadRequestException(msg);
    }
  }

  @Post('reset-password')
  async resetPassword(@Body() body: { resetToken: string; newPassword: string }) {
    const { resetToken, newPassword } = body;
    if (!resetToken || !newPassword) {
      throw new BadRequestException('Reset token and new password are required');
    }
    if (newPassword.length < 6) {
      throw new BadRequestException('Password must be at least 6 characters');
    }
    try {
      const email = this.otp.consumeResetToken(resetToken);
      const {
        data: { users },
        error: listError,
      } = await this.supabase.getClient().auth.admin.listUsers({ perPage: 1000 });
      if (listError) throw new BadRequestException(listError.message);
      const user = users?.find((u) => u.email?.toLowerCase() === email);
      if (!user) throw new BadRequestException('User not found');
      const { error } = await this.supabase.getClient().auth.admin.updateUserById(user.id, {
        password: newPassword,
      });
      if (error) throw new BadRequestException(error.message);
      return { success: true, message: 'Password reset successfully' };
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
      const msg = e instanceof Error ? e.message : 'Failed to reset password. Please try again.';
      throw new BadRequestException(msg);
    }
  }
}
