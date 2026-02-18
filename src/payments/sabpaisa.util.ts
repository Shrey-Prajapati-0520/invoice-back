import * as crypto from 'crypto';

const ALGORITHM = 'aes-128-cbc';

/**
 * SabPaisa uses AES-128-CBC encryption.
 * AuthKey and AuthIV must be exactly 16 bytes each.
 */
export function encrypt(plainText: string, authKey: string, authIV: string): string {
  const key = Buffer.from(authKey.trim().slice(0, 16).padEnd(16, '0'), 'utf8');
  const iv = Buffer.from(authIV.trim().slice(0, 16).padEnd(16, '0'), 'utf8');
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(plainText, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return encrypted;
}

export function decrypt(encryptedHex: string, authKey: string, authIV: string): string {
  const key = Buffer.from(authKey.trim().slice(0, 16).padEnd(16, '0'), 'utf8');
  const iv = Buffer.from(authIV.trim().slice(0, 16).padEnd(16, '0'), 'utf8');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}
