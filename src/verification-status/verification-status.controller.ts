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

@Controller('verification-status')
@UseGuards(AuthGuard)
export class VerificationStatusController {
  constructor(private readonly supabase: SupabaseService) {}

  private getClient() {
    return this.supabase.getClient();
  }

  private isValidPAN(v: string): boolean {
    return /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(v?.trim().toUpperCase().replace(/\s/g, '') ?? '');
  }

  private isValidGSTIN(v: string): boolean {
    return /^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/.test(v?.trim().toUpperCase().replace(/\s/g, '') ?? '');
  }

  @Get()
  async get(@Request() req: { user: { id: string } }) {
    const { data, error } = await this.getClient()
      .from('verification_status')
      .select('*')
      .eq('user_id', req.user.id)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    return data ?? null;
  }

  @Post('pan')
  async savePan(
    @Request() req: { user: { id: string } },
    @Body() body: { pan_number: string; pan_holder_name: string },
  ) {
    const panNumber = body?.pan_number?.trim().toUpperCase().replace(/\s/g, '') ?? '';
    const panHolderName = body?.pan_holder_name?.trim() ?? '';
    if (!this.isValidPAN(panNumber)) {
      throw new BadRequestException('Invalid PAN format. Use 10 characters e.g. ABCDE1234F');
    }
    if (!panHolderName || panHolderName.length < 2) {
      throw new BadRequestException('Name on PAN card is required');
    }
    const payload = {
      user_id: req.user.id,
      pan: 'verified',
      pan_number: panNumber,
      pan_holder_name: panHolderName,
      pan_verified_at: new Date().toISOString(),
    };
    const { data, error } = await this.getClient()
      .from('verification_status')
      .upsert(payload, { onConflict: 'user_id' })
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  @Post('gstin')
  async saveGstin(
    @Request() req: { user: { id: string } },
    @Body() body: { gstin_number: string },
  ) {
    const gstinNumber = body?.gstin_number?.trim().toUpperCase().replace(/\s/g, '') ?? '';
    if (!this.isValidGSTIN(gstinNumber)) {
      throw new BadRequestException('Invalid GSTIN format. Use 15 characters e.g. 24ABCDE1234F1Z5');
    }
    const payload = {
      user_id: req.user.id,
      gstin: 'verified',
      gstin_number: gstinNumber,
      gstin_verified_at: new Date().toISOString(),
    };
    const { data, error } = await this.getClient()
      .from('verification_status')
      .upsert(payload, { onConflict: 'user_id' })
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }
}
