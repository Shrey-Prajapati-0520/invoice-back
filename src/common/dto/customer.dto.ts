import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { stripNullBytes } from '../validation/sanitize.util';
import { MAX_NAME_LEN, MAX_EMAIL_LEN, MAX_PHONE_LEN, MAX_COLOR_LEN } from '../validation/sanitize.util';

export class CreateCustomerDto {
  @IsString()
  @MaxLength(MAX_NAME_LEN)
  @Transform(({ value }) => stripNullBytes(String(value ?? '').trim()))
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_PHONE_LEN)
  @Transform(({ value }) => (value != null && value !== '' ? String(value).replace(/\D/g, '').slice(-10) : undefined))
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_EMAIL_LEN)
  @Transform(({ value }) => (value != null && String(value).trim() ? stripNullBytes(String(value).trim().toLowerCase()) : undefined))
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  @Transform(({ value }) => (value != null && String(value).trim() ? stripNullBytes(String(value).trim()) : undefined))
  initials?: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_COLOR_LEN)
  @Transform(({ value }) => (value != null && String(value).trim() ? stripNullBytes(String(value).trim()) : undefined))
  color?: string;
}

export class UpdateCustomerDto {
  @IsOptional()
  @IsString()
  @MaxLength(MAX_NAME_LEN)
  @Transform(({ value }) => (value != null ? stripNullBytes(String(value).trim()) : undefined))
  name?: string;

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
  @Transform(({ value }) => (value != null ? stripNullBytes(String(value).trim()) : undefined))
  initials?: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_COLOR_LEN)
  @Transform(({ value }) => (value != null ? stripNullBytes(String(value).trim()) : undefined))
  color?: string;
}
