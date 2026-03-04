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
}
