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
}
