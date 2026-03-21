import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { HttpExceptionFilter } from './common/http-exception.filter';
import { ThrottlerExceptionFilter } from './common/throttler-exception.filter';
import { AppController } from './app.controller';
import { CommonModule } from './common/common.module';
import { AppService } from './app.service';
import { SupabaseModule } from './supabase.module';
import { MailModule } from './mail/mail.module';
import { AuthModule } from './auth/auth.module';
import { AddressesModule } from './addresses/addresses.module';
import { CustomersModule } from './customers/customers.module';
import { ItemsModule } from './items/items.module';
import { BankAccountsModule } from './bank-accounts/bank-accounts.module';
import { BusinessProfilesModule } from './business-profiles/business-profiles.module';
import { InvoiceSettingsModule } from './invoice-settings/invoice-settings.module';
import { TermsModule } from './terms/terms.module';
import { VerificationStatusModule } from './verification-status/verification-status.module';
import { InvoicesModule } from './invoices/invoices.module';
import { QuotationsModule } from './quotations/quotations.module';
import { RecurringInvoicesModule } from './recurring-invoices/recurring-invoices.module';
import { PaymentsModule } from './payments/payments.module';
import { ProfilesModule } from './profiles/profiles.module';
import { MessagesModule } from './messages/messages.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PushModule } from './push/push.module';
import { HealthModule } from './health/health.module';
import { ReminderSettingsModule } from './reminder-settings/reminder-settings.module';
import { RemindersModule } from './reminders/reminders.module';
import { ReportsModule } from './reports/reports.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    CommonModule,
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
    SupabaseModule,
    MailModule,
    AuthModule,
    AddressesModule,
    CustomersModule,
    ItemsModule,
    BankAccountsModule,
    BusinessProfilesModule,
    InvoiceSettingsModule,
    TermsModule,
    VerificationStatusModule,
    InvoicesModule,
    QuotationsModule,
    RecurringInvoicesModule,
    PaymentsModule,
    ProfilesModule,
    MessagesModule,
    NotificationsModule,
    PushModule,
    HealthModule,
    ReminderSettingsModule,
    RemindersModule,
    ReportsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: ThrottlerExceptionFilter },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule {}
