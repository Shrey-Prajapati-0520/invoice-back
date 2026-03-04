import { Module } from '@nestjs/common';
import { RemindersController } from './reminders.controller';
import { PushModule } from '../push/push.module';

@Module({
  imports: [PushModule],
  controllers: [RemindersController],
})
export class RemindersModule {}
