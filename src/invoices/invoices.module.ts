import { Module } from '@nestjs/common';
import { InvoicesController } from './invoices.controller';
import { MailModule } from '../mail/mail.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PushModule } from '../push/push.module';
import { InvoiceRealtimeModule } from '../invoice-realtime/invoice-realtime.module';

@Module({
  imports: [MailModule, NotificationsModule, PushModule, InvoiceRealtimeModule],
  controllers: [InvoicesController],
})
export class InvoicesModule {}
