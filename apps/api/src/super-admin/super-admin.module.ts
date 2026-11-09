import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AutomationService } from './automation';
import { LimitAlertsService } from './limit-alerts';
import { RegistrationController, SuperAdminController } from './super-admin.controller';
import { SuperAdminService } from './super-admin.service';

@Module({
  imports: [AuthModule],
  controllers: [SuperAdminController, RegistrationController],
  providers: [SuperAdminService, AutomationService, LimitAlertsService],
  exports: [SuperAdminService, LimitAlertsService],
})
export class SuperAdminModule {}
