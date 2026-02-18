import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import * as crypto from 'crypto';

interface StoredOtp {
  code: string;
  expiresAt: number;
}

interface StoredResetToken {
  email: string;
  expiresAt: number;
}

@Injectable()
export class OtpService {
  private readonly otpStore = new Map<string, StoredOtp>();
  private readonly resetTokenStore = new Map<string, StoredResetToken>();
  private transporter: nodemailer.Transporter | null = null;

  constructor(private config: ConfigService) {
    this.initTransporter();
  }

  private initTransporter() {
    const host = this.config.get<string>('SMTP_HOST');
    const port = this.config.get<number>('SMTP_PORT');
    const user = this.config.get<string>('SMTP_USER');
    const pass = this.config.get<string>('SMTP_PASS');
    const from = this.config.get<string>('SMTP_FROM');

    if (host && user && pass) {
      this.transporter = nodemailer.createTransport({
        host,
        port: port ?? 587,
        secure: port === 465,
        auth: { user, pass },
      });
    }
  }

  private generateCode(): string {
    return String(Math.floor(100000 + Math.random() * 900000));
  }

  async sendOtp(email: string): Promise<void> {
    const normalized = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      throw new Error('Invalid email address');
    }

    const code = this.generateCode();
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes
    this.otpStore.set(normalized, { code, expiresAt });

    if (this.transporter) {
      await this.transporter.sendMail({
        from: this.config.get('SMTP_FROM') || 'Trustopay <noreply@trustopay.com>',
        to: normalized,
        subject: 'Your verification code - Trustopay',
        html: `
          <div style="font-family: sans-serif; max-width: 400px; margin: 0 auto;">
            <h2 style="color: #0A192F;">Verification Code</h2>
            <p>Use the following 6-digit code to verify your email:</p>
            <p style="font-size: 28px; font-weight: bold; letter-spacing: 8px; color: #7C3AED;">${code}</p>
            <p style="color: #6B7280; font-size: 14px;">This code expires in 10 minutes.</p>
            <p style="color: #6B7280; font-size: 14px;">If you didn't request this, you can safely ignore this email.</p>
          </div>
        `,
      });
    } else {
      // Development: log to console
      console.log(`[OTP] No SMTP configured. Code for ${normalized}: ${code} (expires in 10 min)`);
    }
  }

  verifyOtp(email: string, code: string): string {
    const normalized = email.trim().toLowerCase();
    const stored = this.otpStore.get(normalized);
    if (!stored) {
      throw new Error('No OTP found for this email. Please request a new code.');
    }
    if (Date.now() > stored.expiresAt) {
      this.otpStore.delete(normalized);
      throw new Error('OTP has expired. Please request a new code.');
    }
    if (stored.code !== code.trim()) {
      throw new Error('Invalid verification code.');
    }
    this.otpStore.delete(normalized);

    const resetToken = crypto.randomBytes(32).toString('hex');
    const tokenExpiresAt = Date.now() + 15 * 60 * 1000; // 15 minutes
    this.resetTokenStore.set(resetToken, { email: normalized, expiresAt: tokenExpiresAt });
    return resetToken;
  }

  /** Validate OTP without creating reset token (for login flow) */
  verifyOtpOnly(email: string, code: string): void {
    const normalized = email.trim().toLowerCase();
    const stored = this.otpStore.get(normalized);
    if (!stored) {
      throw new Error('No OTP found for this email. Please request a new code.');
    }
    if (Date.now() > stored.expiresAt) {
      this.otpStore.delete(normalized);
      throw new Error('OTP has expired. Please request a new code.');
    }
    if (stored.code !== code.trim()) {
      throw new Error('Invalid verification code.');
    }
    this.otpStore.delete(normalized);
  }

  consumeResetToken(token: string): string {
    const stored = this.resetTokenStore.get(token);
    if (!stored) {
      throw new Error('Invalid or expired reset token.');
    }
    if (Date.now() > stored.expiresAt) {
      this.resetTokenStore.delete(token);
      throw new Error('Reset token has expired.');
    }
    this.resetTokenStore.delete(token);
    return stored.email;
  }

  /** Clean expired entries periodically */
  cleanup() {
    const now = Date.now();
    for (const [key, val] of this.otpStore) {
      if (val.expiresAt < now) this.otpStore.delete(key);
    }
    for (const [key, val] of this.resetTokenStore) {
      if (val.expiresAt < now) this.resetTokenStore.delete(key);
    }
  }
}
