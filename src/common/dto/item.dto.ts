import { IsNumber, IsOptional, IsString, Max, Min, MaxLength } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { stripNullBytes } from '../validation/sanitize.util';
import { MAX_NAME_LEN, MAX_DESCRIPTION_LEN } from '../validation/sanitize.util';

export class CreateItemDto {
  @IsString()
  @MaxLength(MAX_NAME_LEN)
  @Transform(({ value }) => stripNullBytes(String(value ?? '').trim()))
  name!: string;

  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(999_999_999.99)
  rate?: number;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_DESCRIPTION_LEN)
  @Transform(({ value }) => (value != null ? stripNullBytes(String(value).trim()) : undefined))
  description?: string;
}

export class UpdateItemDto {
  @IsOptional()
  @IsString()
  @MaxLength(MAX_NAME_LEN)
  @Transform(({ value }) => (value != null ? stripNullBytes(String(value).trim()) : undefined))
  name?: string;

  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(999_999_999.99)
  rate?: number;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_DESCRIPTION_LEN)
  @Transform(({ value }) => (value != null ? stripNullBytes(String(value).trim()) : undefined))
  description?: string;
}
