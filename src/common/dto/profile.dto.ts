import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { stripNullBytes } from '../validation/sanitize.util';
import { MAX_NAME_LEN, MAX_EMAIL_LEN, MAX_PHONE_LEN } from '../validation/sanitize.util';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(MAX_NAME_LEN)
  @Transform(({ value }) => (value != null ? stripNullBytes(String(value).trim()) : undefined))
  full_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_PHONE_LEN)
  @Transform(({ value }) => (value != null ? String(value).replace(/\D/g, '').slice(-10) : undefined))
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_EMAIL_LEN)
  @Transform(({ value }) => (value != null ? stripNullBytes(String(value).trim().toLowerCase()) : undefined))
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  @Matches(/^\d{6}$/, { message: 'Pincode must be 6 digits' })
  @Transform(({ value }) => (value != null ? String(value).replace(/\D/g, '').slice(0, 6) : undefined))
  pincode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(({ value }) => (value != null ? stripNullBytes(String(value).trim()) : undefined))
  expo_push_token?: string;
}
