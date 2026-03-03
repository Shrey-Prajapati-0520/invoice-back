import { Module } from '@nestjs/common';
import { VerificationStatusController } from './verification-status.controller';

@Module({ controllers: [VerificationStatusController] })
export class VerificationStatusModule {}
