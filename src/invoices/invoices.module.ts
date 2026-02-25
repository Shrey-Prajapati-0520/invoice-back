import { Module } from '@nestjs/common';
import { InvoicesController } from './invoices.controller';
import { MailModule } from '../mail/mail.module';
import { PushModule } from '../push/push.module';

@Module({
  imports: [MailModule, PushModule],
  controllers: [InvoicesController],
})
export class InvoicesModule {}
