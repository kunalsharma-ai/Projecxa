import { Module } from '@nestjs/common';
import { SuperAdminModule } from '../super-admin/super-admin.module';
import { BillingAdminController, BillingController, BillingWebhookController } from './billing.controller';
import { BillingService } from './billing.service';

@Module({
  imports: [SuperAdminModule],
  controllers: [BillingController, BillingAdminController, BillingWebhookController],
  providers: [BillingService],
  exports: [BillingService],
})
export class BillingModule {}
