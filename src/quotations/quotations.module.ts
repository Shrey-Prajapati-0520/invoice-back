import { Module } from '@nestjs/common';
import { QuotationsController } from './quotations.controller';
import { PushModule } from '../push/push.module';

@Module({
  imports: [PushModule],
  controllers: [QuotationsController],
})
export class QuotationsModule {}
