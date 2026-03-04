import { Module } from '@nestjs/common';
import { RemindersController } from './reminders.controller';

@Module({ controllers: [RemindersController] })
export class RemindersModule {}
