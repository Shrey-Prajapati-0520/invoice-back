import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { SupabaseService } from '../supabase.service';
import { AuthGuard } from '../auth/auth.guard';

@Controller('reminder-settings')
@UseGuards(AuthGuard)
export class ReminderSettingsController {
  constructor(private readonly supabase: SupabaseService) {}

  private getClient() {
    return this.supabase.getClient();
  }

  @Get()
  async get(@Request() req: { user: { id: string } }) {
    const { data, error } = await this.getClient()
      .from('reminder_settings')
      .select('*')
      .eq('user_id', req.user.id)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    return data ?? null;
  }

  @Post()
  async upsert(
    @Request() req: { user: { id: string } },
    @Body()
    body: {
      template_id?: string;
      subject?: string;
      message?: string;
      send_via_email?: boolean;
      send_via_sms?: boolean;
      attach_pdf?: boolean;
      cc_me?: boolean;
      log_activity?: boolean;
    },
  ) {
    const payload = {
      user_id: req.user.id,
      template_id: body.template_id?.trim() || 'friendly',
      subject: body.subject ?? null,
      message: body.message ?? null,
      send_via_email: body.send_via_email ?? true,
      send_via_sms: body.send_via_sms ?? false,
      attach_pdf: body.attach_pdf ?? true,
      cc_me: body.cc_me ?? false,
      log_activity: body.log_activity ?? true,
    };

    const { data, error } = await this.getClient()
      .from('reminder_settings')
      .upsert(payload, { onConflict: 'user_id', ignoreDuplicates: false })
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }
}
