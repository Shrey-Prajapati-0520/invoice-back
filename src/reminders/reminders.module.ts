import { Module } from '@nestjs/common';
import { RemindersController } from './reminders.controller';
import { PushModule } from '../push/push.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [PushModule, NotificationsModule],
  controllers: [RemindersController],
})
export class RemindersModule {}
