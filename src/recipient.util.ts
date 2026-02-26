/**
 * Shared utilities for recipient matching (received invoices/quotations).
 * Ensures User B sees items sent to them when their phone/email matches the customer.
 */

/** Normalize phone to last 10 digits (Indian mobile). */
export function normalizePhone(phone: string | null | undefined): string {
  if (!phone) return '';
  return String(phone).replace(/\D/g, '').slice(-10);
}

/** Normalize email: lowercase, trim. */
export function normalizeEmail(email: string | null | undefined): string {
  if (!email || typeof email !== 'string') return '';
  return email.toLowerCase().trim();
}

/** Ensure phone has at least 10 digits for storage. */
export function phoneForStorage(phone: string | null | undefined): string | null {
  const digits = String(phone ?? '').replace(/\D/g, '');
  if (digits.length < 10) return null;
  return digits.slice(-10);
}

/** Ensure email is valid for storage. */
export function emailForStorage(email: string | null | undefined): string | null {
  const e = normalizeEmail(email);
  if (!e || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return null;
  return e;
}
