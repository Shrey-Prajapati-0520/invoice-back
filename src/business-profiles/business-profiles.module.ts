import { Module } from '@nestjs/common';
import { BusinessProfilesController } from './business-profiles.controller';

@Module({ controllers: [BusinessProfilesController] })
export class BusinessProfilesModule {}
