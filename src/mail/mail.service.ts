import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private transporter: nodemailer.Transporter | null = null;

  constructor(private config: ConfigService) {
    this.initTransporter();
  }

  private initTransporter() {
    const host = this.config.get<string>('SMTP_HOST');
    const port = this.config.get<number>('SMTP_PORT');
    const user = this.config.get<string>('SMTP_USER');
    const pass = this.config.get<string>('SMTP_PASS');

    if (host && user && pass) {
      this.transporter = nodemailer.createTransport({
        host,
        port: port ?? 587,
        secure: port === 465,
        auth: { user, pass },
        // Force IPv4 (fixes ENETUNREACH on Railway when IPv6 is unreachable)
        family: 4,
      });
    } else {
      this.transporter = null;
    }
  }

  async sendInvoiceNotificationToReceiver(options: {
    to: string;
    senderName: string;
    invoiceNumber: string;
    amount?: string;
  }): Promise<void> {
    const { to, senderName, invoiceNumber, amount } = options;
    const subject = `Invoice ${invoiceNumber} from ${senderName}`;
    const html = `
      <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto;">
        <h2 style="color: #0A192F;">You have received an invoice</h2>
        <p><strong>${senderName}</strong> has sent you an invoice.</p>
        <p><strong>Invoice number:</strong> ${invoiceNumber}</p>
        ${amount ? `<p><strong>Amount:</strong> ${amount}</p>` : ''}
        <p style="color: #6B7280; font-size: 14px;">Please check the InvoiceBill app or contact the sender for payment details.</p>
      </div>
    `;

    if (this.transporter) {
      await this.transporter.sendMail({
        from: this.config.get('SMTP_FROM') || 'InvoiceBill <noreply@invoicebill.com>',
        to: to.trim().toLowerCase(),
        subject,
        html,
      });
    } else {
      console.log(`[Mail] No SMTP configured. Invoice notification for ${to}: ${invoiceNumber} from ${senderName}`);
    }
  }

  async sendReminderEmail(options: {
    to: string;
    cc?: string;
    senderName: string;
    subject: string;
    body: string;
    invoiceNumber?: string;
    amount?: string;
    dueDate?: string;
  }): Promise<void> {
    const { to, cc, senderName, subject, body, invoiceNumber, amount, dueDate } = options;
    const html = `
      <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto;">
        <p style="white-space: pre-wrap;">${body.replace(/\n/g, '<br>')}</p>
        ${invoiceNumber || amount || dueDate ? `
        <div style="margin-top: 16px; padding: 12px; background: #f3f4f6; border-radius: 8px;">
          ${invoiceNumber ? `<p><strong>Invoice:</strong> ${invoiceNumber}</p>` : ''}
          ${amount ? `<p><strong>Amount:</strong> ${amount}</p>` : ''}
          ${dueDate ? `<p><strong>Due Date:</strong> ${dueDate}</p>` : ''}
        </div>
        ` : ''}
      </div>
    `;

    const mailOptions: { to: string; cc?: string; subject: string; html: string } = {
      to: to.trim().toLowerCase(),
      subject,
      html,
    };
    if (cc?.trim()) mailOptions.cc = cc.trim().toLowerCase();

    if (this.transporter) {
      await this.transporter.sendMail({
        from: this.config.get('SMTP_FROM') || 'InvoiceBill <noreply@invoicebill.com>',
        ...mailOptions,
      });
    } else {
      console.log(`[Mail] No SMTP configured. Reminder for ${to}: ${subject} from ${senderName}`);
    }
  }

  async sendPasswordResetOtp(options: { to: string; otp: string }): Promise<void> {
    const { to, otp } = options;
    const subject = 'Reset Your Password';
    const html = `
      <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto; text-align: center;">
        <div style="background: #EFF6FF; border: 3px solid #7C3AED; border-radius: 12px; padding: 30px; margin: 30px 0;">
          <div style="font-size: 12px; color: #7C3AED; text-transform: uppercase; letter-spacing: 2px; font-weight: 600; margin-bottom: 15px;">Your Verification Code</div>
          <div style="font-size: 40px; font-weight: bold; color: #7C3AED; letter-spacing: 10px; font-family: 'Courier New', Monaco, monospace;">${otp}</div>
        </div>
        <p style="color: #888; font-size: 14px;">This code expires in <strong>60 minutes</strong>. If you didn't request this code, please ignore this email.</p>
        <p style="color: #999; font-size: 12px; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e0e0e0;">This is an automated message from Trustopay. Please do not reply to this email.</p>
      </div>
    `;

    if (this.transporter) {
      await this.transporter.sendMail({
        from: this.config.get('SMTP_FROM') || 'Trustopay <noreply@trustopay.com>',
        to: to.trim().toLowerCase(),
        subject,
        html,
      });
    } else {
      console.log(`[Mail] No SMTP configured. Password reset OTP for ${to}: ${otp}`);
      throw new Error('SMTP not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASS in backend .env to send OTP emails.');
    }
  }
}
