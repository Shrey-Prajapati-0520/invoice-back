import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase.module';
import { PushService } from './push.service';
import { PushTokensController } from './push-tokens.controller';

@Module({
  imports: [SupabaseModule],
  controllers: [PushTokensController],
  providers: [PushService],
  exports: [PushService],
})
export class PushModule {}
