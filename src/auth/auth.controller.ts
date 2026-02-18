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
    const { data, error } = await this.supabase.getClient().auth.signUp({
      email: body.email,
      password: body.password,
      options: { data: { full_name: body.full_name } },
    });
    if (error) throw new BadRequestException(error.message);
    return { user: data.user, session: data.session };
  }

  @Post('login')
  async login(@Body() body: { email: string; password: string }) {
    const { data, error } =
      await this.supabase.getClient().auth.signInWithPassword(body);
    if (error) throw new UnauthorizedException(error.message);
    return { user: data.user, session: data.session };
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
    this.otp.cleanup();
    await this.otp.sendOtp(email);
    return { success: true, message: 'Verification code sent to your email' };
  }

  @Post('verify-otp')
  async verifyOtp(@Body() body: { email: string; code: string }) {
    const email = body?.email?.trim?.();
    const code = body?.code?.trim?.();
    if (!email || !code) {
      throw new BadRequestException('Email and code are required');
    }
    const resetToken = this.otp.verifyOtp(email, code);
    return { resetToken };
  }

  @Post('login-with-otp')
  async loginWithOtp(@Body() body: { email: string; code: string }) {
    const email = body?.email?.trim?.().toLowerCase();
    const code = body?.code?.trim?.();
    if (!email || !code) {
      throw new BadRequestException('Email and code are required');
    }
    this.otp.verifyOtpOnly(email, code);
    const {
      data: linkData,
      error: linkError,
    } = await this.supabase.getClient().auth.admin.generateLink({
      type: 'magiclink',
      email,
    });
    if (linkError) throw new BadRequestException(linkError.message);
    const hashedToken = (linkData as { properties?: { hashed_token?: string } })?.properties?.hashed_token;
    if (!hashedToken) throw new BadRequestException('Failed to generate login link');
    const {
      data: sessionData,
      error: verifyError,
    } = await this.supabase.getClient().auth.verifyOtp({
      token_hash: hashedToken,
      type: 'email',
    });
    if (verifyError) throw new UnauthorizedException(verifyError.message);
    return { user: sessionData.user, session: sessionData.session };
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
  }
}
