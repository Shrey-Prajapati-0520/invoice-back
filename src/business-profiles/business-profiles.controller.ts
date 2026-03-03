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

@Controller('business-profiles')
@UseGuards(AuthGuard)
export class BusinessProfilesController {
  constructor(private readonly supabase: SupabaseService) {}

  private getClient() {
    return this.supabase.getClient();
  }

  private isValidIFSC(v: string): boolean {
    return /^[A-Z]{4}0[A-Z0-9]{6}$/.test(v?.trim().toUpperCase() ?? '');
  }

  private isValidPAN(v: string): boolean {
    return /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(v?.trim().toUpperCase() ?? '');
  }

  private isValidGSTIN(v: string): boolean {
    return /^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/.test(v?.trim().toUpperCase() ?? '');
  }

  private isValidPincode(v: string): boolean {
    return /^\d{6}$/.test(v?.replace(/\D/g, '') ?? '');
  }

  @Get()
  async get(@Request() req: { user: { id: string } }) {
    const { data, error } = await this.getClient()
      .from('business_profiles')
      .select('*')
      .eq('user_id', req.user.id)
      .single();
    if (error && error.code !== 'PGRST116') {
      throw new BadRequestException(error.message);
    }
    return data ?? null;
  }

  @Post()
  @Patch()
  async upsert(
    @Request() req: { user: { id: string } },
    @Body()
    body: {
      account_type: 'individual' | 'business';
      full_name?: string;
      professional_title?: string;
      pan?: string;
      company_name?: string;
      role?: string;
      business_type?: string;
      industry?: string;
      registration_number?: string;
      gstin?: string;
      address_line1?: string;
      address_line2?: string;
      city?: string;
      state?: string;
      pincode?: string;
      country?: string;
      account_holder?: string;
      account_number_last4?: string;
      ifsc?: string;
      bank_name?: string;
      branch_name?: string;
      logo_url?: string;
      show_logo_on_invoice?: boolean;
    },
  ) {
    const accountType = body.account_type;
    if (!accountType || !['individual', 'business'].includes(accountType)) {
      throw new BadRequestException('account_type must be "individual" or "business"');
    }

    const payload: Record<string, unknown> = {
      user_id: req.user.id,
      account_type: accountType,
    };

    if (body.full_name != null) payload.full_name = body.full_name?.trim() || null;
    if (body.professional_title != null) payload.professional_title = body.professional_title?.trim() || null;
    if (body.company_name != null) payload.company_name = body.company_name?.trim() || null;
    if (body.role != null) payload.role = body.role?.trim() || null;
    if (body.business_type != null) payload.business_type = body.business_type?.trim() || null;
    if (body.industry != null) payload.industry = body.industry?.trim() || null;
    if (body.registration_number != null) payload.registration_number = body.registration_number?.trim() || null;
    if (body.address_line1 != null) payload.address_line1 = body.address_line1?.trim() || null;
    if (body.address_line2 != null) payload.address_line2 = body.address_line2?.trim() || null;
    if (body.city != null) payload.city = body.city?.trim() || null;
    if (body.state != null) payload.state = body.state?.trim() || null;
    if (body.country != null) payload.country = body.country?.trim() || null;
    if (body.account_holder != null) payload.account_holder = body.account_holder?.trim() || null;
    if (body.bank_name != null) payload.bank_name = body.bank_name?.trim() || null;
    if (body.branch_name != null) payload.branch_name = body.branch_name?.trim() || null;
    if (body.logo_url != null) payload.logo_url = body.logo_url?.trim() || null;

    if (body.pan != null) {
      const pan = body.pan.trim().toUpperCase();
      if (pan && !this.isValidPAN(pan)) {
        throw new BadRequestException('Invalid PAN format. Use 10 characters e.g. ABCDE1234F');
      }
      payload.pan = pan || null;
    }

    if (body.gstin != null) {
      const gstin = body.gstin.trim().toUpperCase();
      if (gstin && !this.isValidGSTIN(gstin)) {
        throw new BadRequestException('Invalid GSTIN format. Use 15 characters e.g. 24ABCDE1234F1Z5');
      }
      payload.gstin = gstin || null;
    }

    if (body.pincode != null) {
      const pc = body.pincode.replace(/\D/g, '');
      if (pc && !this.isValidPincode(pc)) {
        throw new BadRequestException('PIN code must be 6 digits');
      }
      payload.pincode = pc || null;
    }

    if (body.ifsc != null) {
      const ifsc = body.ifsc.trim().toUpperCase();
      if (ifsc && !this.isValidIFSC(ifsc)) {
        throw new BadRequestException('Invalid IFSC code. Use 11 characters e.g. HDFC0001234');
      }
      payload.ifsc = ifsc || null;
    }

    if (body.account_number_last4 != null) {
      const last4 = body.account_number_last4.replace(/\D/g, '').slice(-4);
      payload.account_number_last4 = last4 || null;
    }

    const { data: existing } = await this.getClient()
      .from('business_profiles')
      .select('id')
      .eq('user_id', req.user.id)
      .single();

    let result;
    if (existing) {
      const { data, error } = await this.getClient()
        .from('business_profiles')
        .update(payload)
        .eq('user_id', req.user.id)
        .select()
        .single();
      if (error) throw new BadRequestException(error.message);
      result = data;
    } else {
      const { data, error } = await this.getClient()
        .from('business_profiles')
        .insert(payload)
        .select()
        .single();
      if (error) throw new BadRequestException(error.message);
      result = data;
    }
    return result;
  }
}
