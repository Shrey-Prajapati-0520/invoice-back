import { Module } from '@nestjs/common';
import { TermsController } from './terms.controller';

@Module({ controllers: [TermsController] })
export class TermsModule {}
