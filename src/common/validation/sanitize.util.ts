/**
 * Input sanitization utilities to prevent injection and malformed data.
 */

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NULL_BYTE = /\0/g;

/** Reject strings containing null bytes (can break parsing / cause injection). */
export function stripNullBytes(s: string | null | undefined): string {
  if (s == null || typeof s !== 'string') return '';
  return s.replace(NULL_BYTE, '');
}

/** Truncate to max length; strip null bytes. */
export function safeString(value: unknown, maxLen: number): string {
  const s = stripNullBytes(String(value ?? '').trim());
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

/** Validate and return UUID or null. */
export function parseUuid(value: unknown): string | null {
  const s = typeof value === 'string' ? value.trim() : '';
  return UUID_REGEX.test(s) ? s : null;
}

/** Validate UUID; returns null if invalid. Caller should throw BadRequestException. */
export function assertUuid(value: unknown): string | null {
  return parseUuid(value);
}

/** Allowed image MIME types for avatar upload (no SVG - can contain scripts). */
export const ALLOWED_IMAGE_TYPES = ['png', 'jpeg', 'jpg', 'webp'] as const;

/** Check if extension is allowed for image upload. */
export function isAllowedImageType(ext: string): ext is (typeof ALLOWED_IMAGE_TYPES)[number] {
  const lower = ext?.toLowerCase?.() ?? '';
  return (ALLOWED_IMAGE_TYPES as readonly string[]).includes(lower);
}

/** Max sizes (bytes). */
export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
export const MAX_NAME_LEN = 500;
export const MAX_EMAIL_LEN = 255;
export const MAX_PHONE_LEN = 20;
export const MAX_DESCRIPTION_LEN = 5000;
export const MAX_COLOR_LEN = 50;
