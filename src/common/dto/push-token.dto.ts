import { IsString, Matches, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { stripNullBytes } from '../validation/sanitize.util';

const EXPO_TOKEN_REGEX = /^(ExponentPushToken|ExpoPushToken)\[[-_a-zA-Z0-9]+\]$/;

export class RegisterPushTokenDto {
  @IsString()
  @MaxLength(500)
  @Matches(EXPO_TOKEN_REGEX, { message: 'Invalid Expo push token format' })
  @Transform(({ value }) => stripNullBytes(String(value ?? '').trim()))
  token!: string;
}
