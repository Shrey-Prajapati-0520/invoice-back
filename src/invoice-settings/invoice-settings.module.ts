import { Module } from '@nestjs/common';
import { InvoiceSettingsController } from './invoice-settings.controller';

@Module({ controllers: [InvoiceSettingsController] })
export class InvoiceSettingsModule {}
