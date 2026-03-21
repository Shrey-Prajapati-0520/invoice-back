import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { stripNullBytes } from '../validation/sanitize.util';

export class RegisterDto {
  @IsEmail()
  @MaxLength(255)
  @Transform(({ value }) => stripNullBytes(String(value ?? '').trim()))
  email!: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  @MaxLength(200)
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(({ value }) => (value != null && String(value).trim() ? stripNullBytes(String(value).trim()) : undefined))
  full_name?: string;

  @IsString()
  @Matches(/^[6-9]\d{9}$/, { message: 'Please enter a valid 10-digit Indian mobile number' })
  @Transform(({ value }) => String(value ?? '').replace(/\D/g, '').slice(-10))
  phone!: string;
}

export class LoginDto {
  @IsEmail()
  @MaxLength(255)
  @Transform(({ value }) => stripNullBytes(String(value ?? '').trim()))
  email!: string;

  @IsString()
  @MaxLength(200)
  password!: string;
}

export class RefreshTokenDto {
  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  @Transform(({ value }) => stripNullBytes(String(value ?? '').trim()))
  refresh_token!: string;
}

export class ForgotPasswordDto {
  @IsEmail()
  @MaxLength(255)
  @Transform(({ value }) => stripNullBytes(String(value ?? '').trim().toLowerCase()))
  email!: string;
}

export class ResetPasswordDto {
  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  @Transform(({ value }) => stripNullBytes(String(value ?? '').trim()))
  access_token!: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  @MaxLength(200)
  new_password!: string;
}
