import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { SupabaseService } from '../supabase.service';
import { AuthGuard } from '../auth/auth.guard';

@Controller('addresses')
@UseGuards(AuthGuard)
export class AddressesController {
  constructor(private readonly supabase: SupabaseService) {}

  private getClient() {
    return this.supabase.getClient();
  }

  @Get()
  async list(@Request() req: { user: { id: string } }) {
    const { data, error } = await this.getClient()
      .from('addresses')
      .select('*')
      .eq('user_id', req.user.id)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: true });
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  @Post()
  async create(
    @Request() req: { user: { id: string } },
    @Body()
    body: {
      type: 'home' | 'business' | 'billing';
      business_type?: string;
      is_default?: boolean;
      full_name: string;
      professional_title?: string;
      phone: string;
      email?: string;
      website?: string;
      building: string;
      street: string;
      city: string;
      state: string;
      pincode: string;
      country?: string;
      gstin?: string;
      pan?: string;
      cin?: string;
    },
  ) {
    const fullName = body?.full_name?.trim();
    const phone = body?.phone?.trim();
    const building = body?.building?.trim();
    const street = body?.street?.trim();
    const city = body?.city?.trim();
    const state = body?.state?.trim();
    const pincode = body?.pincode?.trim();
    if (!fullName) throw new BadRequestException('Full name is required');
    if (!phone) throw new BadRequestException('Phone is required');
    if (!building) throw new BadRequestException('Building is required');
    if (!street) throw new BadRequestException('Street/Area is required');
    if (!city) throw new BadRequestException('City is required');
    if (!state) throw new BadRequestException('State is required');
    if (!pincode || !/^\d{6}$/.test(pincode)) throw new BadRequestException('Valid 6-digit PIN is required');
    const type = body?.type && ['home', 'business', 'billing'].includes(body.type) ? body.type : 'home';

    if (body.is_default) {
      await this.getClient()
        .from('addresses')
        .update({ is_default: false })
        .eq('user_id', req.user.id);
    }
    const payload = {
      user_id: req.user.id,
      type,
      business_type: body.business_type?.trim() || null,
      is_default: !!body.is_default,
      full_name: fullName,
      professional_title: body.professional_title?.trim() || null,
      phone,
      email: body.email?.trim() || null,
      website: body.website?.trim() || null,
      building,
      street,
      city,
      state,
      pincode,
      country: body.country?.trim() || 'India',
      gstin: body.gstin?.trim() || null,
      pan: body.pan?.trim() || null,
      cin: body.cin?.trim() || null,
    };
    const { data, error } = await this.getClient()
      .from('addresses')
      .insert(payload)
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  @Patch(':id')
  async update(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
    @Body()
    body: Partial<{
      type: string;
      business_type: string;
      is_default: boolean;
      full_name: string;
      professional_title: string;
      phone: string;
      email: string;
      website: string;
      building: string;
      street: string;
      city: string;
      state: string;
      pincode: string;
      country: string;
      gstin: string;
      pan: string;
      cin: string;
    }>,
  ) {
    const payload: Record<string, unknown> = {};
    if (body.type != null && ['home', 'business', 'billing'].includes(body.type)) payload.type = body.type;
    if (body.business_type != null) payload.business_type = body.business_type.trim() || null;
    if (body.is_default != null) payload.is_default = !!body.is_default;
    if (body.full_name != null) payload.full_name = body.full_name.trim() || null;
    if (body.professional_title != null) payload.professional_title = body.professional_title.trim() || null;
    if (body.phone != null) payload.phone = body.phone.trim() || null;
    if (body.email != null) payload.email = body.email.trim() || null;
    if (body.website != null) payload.website = body.website.trim() || null;
    if (body.building != null) payload.building = body.building.trim() || null;
    if (body.street != null) payload.street = body.street.trim() || null;
    if (body.city != null) payload.city = body.city.trim() || null;
    if (body.state != null) payload.state = body.state.trim() || null;
    if (body.pincode != null) {
      const pc = body.pincode.replace(/\D/g, '').slice(0, 6);
      if (pc && !/^\d{6}$/.test(pc)) throw new BadRequestException('PIN must be 6 digits');
      payload.pincode = pc || null;
    }
    if (body.country != null) payload.country = body.country.trim() || 'India';
    if (body.gstin != null) payload.gstin = body.gstin.trim() || null;
    if (body.pan != null) payload.pan = body.pan.trim() || null;
    if (body.cin != null) payload.cin = body.cin.trim() || null;

    if (Object.keys(payload).length === 0) {
      const { data } = await this.getClient()
        .from('addresses')
        .select('*')
        .eq('id', id)
        .eq('user_id', req.user.id)
        .single();
      if (!data) throw new BadRequestException('Address not found');
      return data;
    }

    if (payload.is_default === true) {
      await this.getClient()
        .from('addresses')
        .update({ is_default: false })
        .eq('user_id', req.user.id);
    }

    const { data, error } = await this.getClient()
      .from('addresses')
      .update(payload)
      .eq('id', id)
      .eq('user_id', req.user.id)
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  @Delete(':id')
  async delete(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
  ) {
    const { data, error } = await this.getClient()
      .from('addresses')
      .delete()
      .eq('id', id)
      .eq('user_id', req.user.id)
      .select('id');
    if (error) throw new BadRequestException(error.message);
    if (!data?.length) throw new NotFoundException('Address not found');
    return { success: true };
  }
}
