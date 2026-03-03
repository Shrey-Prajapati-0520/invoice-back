import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Logger,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { SupabaseService } from '../supabase.service';
import { AuthGuard } from '../auth/auth.guard';

@Controller('verification-status')
@UseGuards(AuthGuard)
export class VerificationStatusController {
  private readonly logger = new Logger(VerificationStatusController.name);

  constructor(private readonly supabase: SupabaseService) {}

  private getClient() {
    return this.supabase.getClient();
  }

  private isValidPAN(v: string): boolean {
    return /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(v?.trim().toUpperCase().replace(/\s/g, '') ?? '');
  }

  private isValidGSTIN(v: string): boolean {
    const s = v?.trim().toUpperCase().replace(/\s/g, '') ?? '';
    if (s.length !== 15) return false;
    // Standard format or 15 alphanumeric with Z at position 14
    return /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(s)
      || (s[13] === 'Z' && /^[A-Z0-9]+$/.test(s));
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
    const userId = req.user.id;
    const updatePayload = {
      pan: 'verified',
      pan_number: panNumber,
      pan_holder_name: panHolderName,
      pan_verified_at: new Date().toISOString(),
    };
    const client = this.getClient();

    // Try to update existing row first
    const { data: updated, error: updateError } = await client
      .from('verification_status')
      .update(updatePayload)
      .eq('user_id', userId)
      .select()
      .maybeSingle();

    if (updateError) {
      this.logger.warn(`PAN update failed: ${updateError.message} (code: ${updateError.code})`);
      throw new BadRequestException(updateError.message);
    }
    if (updated) return updated;

    // No existing row - insert new one
    const insertPayload = {
      user_id: userId,
      ...updatePayload,
    };
    const { data: inserted, error: insertError } = await client
      .from('verification_status')
      .insert(insertPayload)
      .select()
      .single();

    if (insertError) {
      this.logger.warn(`PAN insert failed: ${insertError.message} (code: ${insertError.code})`);
      throw new BadRequestException(insertError.message);
    }
    return inserted;
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
    const userId = req.user.id;
    const updatePayload = {
      gstin: 'verified',
      gstin_number: gstinNumber,
      gstin_verified_at: new Date().toISOString(),
    };
    const client = this.getClient();

    const { data: updated, error: updateError } = await client
      .from('verification_status')
      .update(updatePayload)
      .eq('user_id', userId)
      .select()
      .maybeSingle();

    if (updateError) {
      this.logger.warn(`GSTIN update failed: ${updateError.message} (code: ${updateError.code})`);
      throw new BadRequestException(updateError.message);
    }
    if (updated) return updated;

    const { data: inserted, error: insertError } = await client
      .from('verification_status')
      .insert({ user_id: userId, ...updatePayload })
      .select()
      .single();

    if (insertError) {
      this.logger.warn(`GSTIN insert failed: ${insertError.message} (code: ${insertError.code})`);
      throw new BadRequestException(insertError.message);
    }
    return inserted;
  }
}
