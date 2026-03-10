import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { InvoiceRealtimeModule } from '../invoice-realtime/invoice-realtime.module';
import { SupabaseModule } from '../supabase.module';

@Module({
  imports: [InvoiceRealtimeModule, SupabaseModule],
  controllers: [PaymentsController],
  providers: [PaymentsService],
})
export class PaymentsModule {}
