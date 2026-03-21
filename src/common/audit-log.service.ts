import { Injectable, Logger } from '@nestjs/common';

/** Structured security audit log for auth attempts, errors, and suspicious traffic */
export type AuditEvent =
  | { type: 'auth_login'; success: boolean; email?: string; ip?: string; ua?: string; reason?: string }
  | { type: 'auth_register'; success: boolean; email?: string; ip?: string; ua?: string; reason?: string }
  | { type: 'auth_forgot_password'; success: boolean; email?: string; ip?: string; ua?: string; reason?: string }
  | { type: 'auth_reset_password'; success: boolean; ip?: string; ua?: string; reason?: string }
  | { type: 'auth_refresh'; success: boolean; ip?: string; ua?: string; reason?: string }
  | { type: 'api_error'; status: number; path: string; method: string; ip?: string; ua?: string; userId?: string; msg?: string }
  | { type: 'rate_limit'; path: string; method: string; ip?: string; ua?: string };

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger('AuditLog');

  private sanitizeEmail(email?: string): string {
    if (!email || typeof email !== 'string') return '[redacted]';
    const [local, domain] = email.split('@');
    if (!domain) return '[redacted]';
    const masked = local.length <= 2 ? '**' : local.slice(0, 2) + '***';
    return `${masked}@${domain}`;
  }

  log(event: AuditEvent): void {
    const ts = new Date().toISOString();
    const safe = { ...event, ts } as Record<string, unknown>;
    if ('email' in safe && typeof safe.email === 'string') {
      safe.email = this.sanitizeEmail(safe.email);
    }
    const line = `[AUDIT] ${JSON.stringify(safe)}`;
    const isSuspicious = event.type === 'rate_limit' || (event.type.startsWith('auth_') && !('success' in event ? event.success : true));
    if (isSuspicious) {
      this.logger.warn(line);
    } else {
      this.logger.log(line);
    }
  }
}
