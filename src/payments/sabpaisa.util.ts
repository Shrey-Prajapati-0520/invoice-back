import * as crypto from 'crypto';

const ALGORITHM = 'aes-128-cbc';

/** Parse AuthKey/AuthIV: SabPaisa may provide Base64 or plain. Use first 16 bytes. */
function toBuffer(value: string): Buffer {
  const trimmed = value.trim();
  // If it looks like Base64 (has = or common Base64 chars), try decode
  if (trimmed.length > 20 && /^[A-Za-z0-9+/=]+$/.test(trimmed)) {
    try {
      const decoded = Buffer.from(trimmed, 'base64');
      if (decoded.length >= 16) return decoded.slice(0, 16);
    } catch {
      /* fall through to UTF-8 */
    }
  }
  return Buffer.from(trimmed.slice(0, 16).padEnd(16, '0'), 'utf8');
}

/**
 * SabPaisa uses AES-128-CBC encryption.
 * AuthKey and AuthIV: 16 bytes each. Supports Base64 (from dashboard) or UTF-8.
 */
export function encrypt(plainText: string, authKey: string, authIV: string): string {
  const key = toBuffer(authKey);
  const iv = toBuffer(authIV);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(plainText, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return encrypted;
}

export function decrypt(encryptedHex: string, authKey: string, authIV: string): string {
  const key = toBuffer(authKey);
  const iv = toBuffer(authIV);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}
