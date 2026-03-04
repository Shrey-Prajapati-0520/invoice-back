import { Module } from '@nestjs/common';
import { ReminderSettingsController } from './reminder-settings.controller';

@Module({ controllers: [ReminderSettingsController] })
export class ReminderSettingsModule {}
