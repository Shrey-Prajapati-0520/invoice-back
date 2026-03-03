import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { SupabaseModule } from './supabase.module';
import { MailModule } from './mail/mail.module';
import { AuthModule } from './auth/auth.module';
import { CustomersModule } from './customers/customers.module';
import { ItemsModule } from './items/items.module';
import { BankAccountsModule } from './bank-accounts/bank-accounts.module';
import { BusinessProfilesModule } from './business-profiles/business-profiles.module';
import { InvoiceSettingsModule } from './invoice-settings/invoice-settings.module';
import { TermsModule } from './terms/terms.module';
import { InvoicesModule } from './invoices/invoices.module';
import { QuotationsModule } from './quotations/quotations.module';
import { RecurringInvoicesModule } from './recurring-invoices/recurring-invoices.module';
import { PaymentsModule } from './payments/payments.module';
import { ProfilesModule } from './profiles/profiles.module';
import { MessagesModule } from './messages/messages.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PushModule } from './push/push.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
    SupabaseModule,
    MailModule,
    AuthModule,
    CustomersModule,
    ItemsModule,
    BankAccountsModule,
    BusinessProfilesModule,
    InvoiceSettingsModule,
    TermsModule,
    InvoicesModule,
    QuotationsModule,
    RecurringInvoicesModule,
    PaymentsModule,
    ProfilesModule,
    MessagesModule,
    NotificationsModule,
    PushModule,
    HealthModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
