import { Module } from '@nestjs/common';
import { InvoiceRealtimeGateway } from './invoice-realtime.gateway';

@Module({
  providers: [InvoiceRealtimeGateway],
  exports: [InvoiceRealtimeGateway],
})
export class InvoiceRealtimeModule {}
