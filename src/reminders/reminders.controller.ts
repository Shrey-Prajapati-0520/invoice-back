import {
  BadRequestException,
  Body,
  Controller,
  Logger,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { SupabaseService } from '../supabase.service';
import { MailService } from '../mail/mail.service';
import { PushService } from '../push/push.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthGuard } from '../auth/auth.guard';
import { normalizePhone, phoneForStorage } from '../recipient.util';

@Controller('reminders')
@UseGuards(AuthGuard)
export class RemindersController {
  private readonly logger = new Logger(RemindersController.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly mail: MailService,
    private readonly push: PushService,
    private readonly notifications: NotificationsService,
  ) {}

  private getClient() {
    return this.supabase.getClient();
  }

  @Post('send')
  async send(
    @Request() req: { user: { id: string; email?: string } },
    @Body()
    body: {
      invoice_ids: string[];
      subject: string;
      message: string;
      send_via_email?: boolean;
      send_via_sms?: boolean;
      attach_pdf?: boolean;
      cc_me?: boolean;
      log_activity?: boolean;
    },
  ) {
    const invoiceIds = body.invoice_ids;
    if (!Array.isArray(invoiceIds) || invoiceIds.length === 0) {
      throw new BadRequestException('At least one invoice is required');
    }
    const subject = body.subject?.trim();
    const message = body.message?.trim();
    if (!subject || !message) {
      throw new BadRequestException('Subject and message are required');
    }
    const sendViaEmail = body.send_via_email ?? true;
    const sendViaSms = body.send_via_sms ?? false;
    if (!sendViaEmail && !sendViaSms) {
      throw new BadRequestException('Select at least one channel (email or SMS)');
    }

    const client = this.getClient();

    const { data: invoices, error: invErr } = await client
      .from('invoices')
      .select(
        `
        id,
        number,
        due_date,
        recipient_email,
        recipient_phone,
        user_id,
        customers (id, name, phone, email)
      `,
      )
      .eq('user_id', req.user.id)
      .in('id', invoiceIds);
    if (invErr) throw new BadRequestException(invErr.message);
    if (!invoices?.length) {
      throw new BadRequestException('No valid invoices found');
    }

    const { data: profile } = await client
      .from('profiles')
      .select('full_name, email, phone')
      .eq('id', req.user.id)
      .single();
    const senderName = (profile as { full_name?: string })?.full_name || 'InvoiceBill User';
    const senderPhone = (profile as { phone?: string })?.phone
      ? normalizePhone((profile as { phone?: string }).phone)
      : null;
    const myEmail = (profile as { email?: string })?.email || req.user.email || '';

    const sent: { invoice_id: string; channel: string }[] = [];

    for (const inv of invoices) {
      const cust = inv.customers as { name?: string; email?: string; phone?: string } | null;
      const recipientEmail = (inv.recipient_email as string) || cust?.email;
      const recipientPhone = (inv.recipient_phone as string) || cust?.phone;
      const clientName = cust?.name || 'Customer';
      const invNumber = inv.number as string;
      const dueDate = inv.due_date as string;
      const invId = inv.id as string;

      const items = await client
        .from('invoice_items')
        .select('qty, rate')
        .eq('invoice_id', invId);
      const itemsArr = (items.data ?? []) as { qty?: number; rate?: number }[];
      const amount = itemsArr.reduce(
        (s, i) => s + (Number(i.qty) || 1) * (Number(i.rate) || 0),
        0,
      );
      const amountStr = new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
      }).format(amount);
      const dueDateStr = dueDate
        ? new Date(dueDate).toLocaleDateString('en-IN', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          })
        : '';
      const now = new Date();
      const due = dueDate ? new Date(dueDate) : null;
      const daysOverdue = due && due < now ? Math.floor((now.getTime() - due.getTime()) / 86400000) : 0;

      const bodyText = message
        .replace(/{client_name}/g, clientName)
        .replace(/{invoice_number}/g, invNumber)
        .replace(/{amount}/g, amountStr)
        .replace(/{due_date}/g, dueDateStr)
        .replace(/{days_overdue}/g, String(daysOverdue))
        .replace(/{payment_link}/g, 'trustopay.link/pay/' + invId)
        .replace(/{your_name}/g, senderName);

      const subjText = subject
        .replace(/{client_name}/g, clientName)
        .replace(/{invoice_number}/g, invNumber)
        .replace(/{amount}/g, amountStr)
        .replace(/{due_date}/g, dueDateStr)
        .replace(/{days_overdue}/g, String(daysOverdue))
        .replace(/{payment_link}/g, 'trustopay.link/pay/' + invId)
        .replace(/{your_name}/g, senderName);

      if (sendViaEmail && recipientEmail?.trim()) {
        try {
          await this.mail.sendReminderEmail({
            to: recipientEmail.trim(),
            cc: body.cc_me && myEmail ? myEmail : undefined,
            senderName,
            subject: subjText,
            body: bodyText,
            invoiceNumber: invNumber,
            amount: amountStr,
            dueDate: dueDateStr,
          });
          sent.push({ invoice_id: invId, channel: 'email' });
          await client.from('reminder_log').insert({
            user_id: req.user.id,
            invoice_id: invId,
            channel: 'email',
            recipient_email: recipientEmail.trim(),
            subject: subjText,
          });
        } catch (e) {
          console.error('[Reminders] Email failed for', invId, e);
        }
      }

      if (sendViaSms && recipientPhone?.trim()) {
        sent.push({ invoice_id: invId, channel: 'sms' });
        await client.from('reminder_log').insert({
          user_id: req.user.id,
          invoice_id: invId,
          channel: 'sms',
          recipient_phone: recipientPhone.trim(),
          subject: subjText,
        });
      }
    }

    // Push notifications: sender and receivers (handles null/empty tokens – no crash)
    const pushRecipients: Array<{ token: string; title: string; body: string; data?: Record<string, unknown> }> = [];
    const senderTokens = await this.push.getTokensForUser(req.user.id);
    for (const token of senderTokens) {
      pushRecipients.push({
        token,
        title: 'Reminders sent',
        body: `You sent ${sent.length} reminder${sent.length !== 1 ? 's' : ''} to your clients.`,
        data: { type: 'reminder', count: sent.length },
      });
    }
    const receiverIds = new Set<string>();
    for (const inv of invoices) {
      const cust = inv.customers as { name?: string; email?: string; phone?: string } | null;
      const recipientEmail = (inv.recipient_email as string) || cust?.email;
      const recipientPhone = (inv.recipient_phone as string) || cust?.phone;
      const phone10 = recipientPhone ? (phoneForStorage(recipientPhone) || normalizePhone(recipientPhone)) : null;
      if (phone10) {
        let foundByPhone = false;
        try {
          const { data: byPhoneRpc } = await client.rpc('find_receiver_ids_by_phone', {
            phone_10: phone10,
            exclude_id: req.user.id,
          });
          if (Array.isArray(byPhoneRpc) && byPhoneRpc.length > 0) {
            byPhoneRpc.forEach((r: { id?: string }) => r?.id && receiverIds.add(String(r.id)));
            foundByPhone = true;
          }
        } catch {
          /* RPC fallback */
        }
        if (!foundByPhone) {
          const [exact, suffix] = await Promise.all([
            client.from('profiles').select('id').eq('phone', phone10).neq('id', req.user.id),
            client.from('profiles').select('id').neq('id', req.user.id).ilike('phone', `%${phone10}`),
          ]);
          [...(exact.data ?? []), ...(suffix.data ?? [])].forEach((p: { id: string }) => receiverIds.add(String(p.id)));
        }
      }
      if (recipientEmail?.trim()) {
        const normEmail = (recipientEmail as string).trim().toLowerCase();
        if (normEmail) {
          const { data: byEmail } = await client
            .from('profiles')
            .select('id')
            .ilike('email', normEmail)
            .neq('id', req.user.id);
          (byEmail ?? []).forEach((p: { id: string }) => receiverIds.add(String(p.id)));
        }
      }
    }

    // Notification center: User A (sender)
    try {
      await this.notifications.create({
        user_id: req.user.id,
        user_phone: senderPhone,
        title: 'Reminders sent',
        body: `You sent ${sent.length} reminder${sent.length !== 1 ? 's' : ''} to your clients.`,
        type: 'system',
        reference_id: null,
        deep_link_screen: 'invoices',
      });
    } catch {
      /* non-fatal */
    }

    // Notification center: User B (each receiver)
    const receiverPhones = new Map<string, string>();
    if (receiverIds.size > 0) {
      const { data: profiles } = await client
        .from('profiles')
        .select('id, phone')
        .in('id', Array.from(receiverIds));
      (profiles ?? []).forEach((p: { id: string; phone?: string }) => {
        if (p.phone) receiverPhones.set(p.id, normalizePhone(p.phone));
      });
    }
    for (const receiverId of receiverIds) {
      try {
        await this.notifications.create({
          user_id: receiverId,
          user_phone: receiverPhones.get(receiverId) || null,
          title: `Payment reminder from ${senderName}`,
          body: `${senderName} sent you a payment reminder for your invoice(s).`,
          type: 'system',
          reference_id: null,
          deep_link_screen: 'invoices',
        });
      } catch {
        /* non-fatal */
      }
    }

    for (const receiverId of receiverIds) {
      const receiverTokens = await this.push.getTokensForUser(receiverId);
      if (receiverTokens.length === 0) {
        this.logger.log(`[Push] User ${receiverId} has 0 tokens – no push sent`);
      }
      for (const token of receiverTokens) {
        pushRecipients.push({
          token,
          title: `Payment reminder from ${senderName}`,
          body: `${senderName} sent you a payment reminder for your invoice(s).`,
          data: { type: 'reminder', deep_link_screen: 'invoices' },
        });
      }
    }
    if (pushRecipients.length > 0) {
      try {
        await this.push.sendMany(pushRecipients);
        this.logger.log(`[Push] Reminders: sent to ${senderTokens.length} sender + ${pushRecipients.length - senderTokens.length} receiver token(s)`);
      } catch (e) {
        this.logger.warn('[Push] Reminders push failed (non-fatal):', (e as Error)?.message);
      }
    }

    return { success: true, sent };
  }
}
