import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { OtpService } from './otp.service';

@Module({
  controllers: [AuthController],
  providers: [OtpService],
})
export class AuthModule {}
