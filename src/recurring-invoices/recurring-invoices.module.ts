import { Module } from '@nestjs/common';
import { RecurringInvoicesController } from './recurring-invoices.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { PushModule } from '../push/push.module';

@Module({
  imports: [NotificationsModule, PushModule],
  controllers: [RecurringInvoicesController],
})
export class RecurringInvoicesModule {}
