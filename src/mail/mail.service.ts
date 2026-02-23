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
}
