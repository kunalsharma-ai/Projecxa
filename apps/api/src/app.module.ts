import { Module } from '@nestjs/common';
import { EntitlementsModule } from './super-admin/entitlements';
import { SuperAdminModule } from './super-admin/super-admin.module';
import { BillingModule } from './billing/billing.module';
import { ScheduleModule } from '@nestjs/schedule';
import { AuditModule } from './audit/audit.service';
import { AuthModule } from './auth/auth.module';
import { CallbacksModule } from './callbacks/callbacks.service';
import { ClientsModule } from './clients/clients.controller';
import { AnalyticsModule } from './analytics/analytics.controller';
import { DashboardModule } from './dashboard/dashboard.controller';
import { FinanceModule } from './finance/finance.controller';
import { AccountingModule } from './accounting/accounting.module';
import { AiModule } from './ai/ai.controller';
import { TasksModule } from './tasks/tasks.service';
import { ChatModule } from './chat/chat';
import { MonitorModule } from './monitor/monitor.controller';
import { QuotasModule } from './quotas/quotas.controller';
import { PortalModule } from './portal/portal.controller';
import { ReportsModule } from './reports/reports.controller';
import { WonBidsModule } from './won-bids/won-bids.controller';
import { SampleonModule } from './sampleon/sampleon.controller';
import { PublicApiModule } from './public-api/public-api.controller';
import { WebhooksModule } from './webhooks/webhooks.service';
import { MailModule } from './mail/mail.service';
import { SchedulesModule } from './schedules/schedules.service';
import { IntegrationsModule } from './integrations/integrations.service';
import { PrismaModule } from './prisma/prisma.service';
import { PushModule } from './push/push';
import { ProjectsModule } from './projects/projects.controller';
import { CustomOptionsModule } from './custom-options/custom-options';
import { PartyLogosModule } from './parties/logos';
import { ClientLinksModule } from './client-links/client-links';
import { NumberingModule } from './numbering/numbering';
import { RedirectsModule } from './redirects/redirects.controller';
import { RequestsModule } from './requests/requests.controller';
import { PrivacyModule } from './privacy/privacy';
import { RedirectHealthModule } from './redirect-health/redirect-health';
import { BrandingModule } from './branding/branding';
import { QuotesModule } from './quotes/quotes';
import { VendorSignupModule } from './vendor-signup/vendor-signup';
import { SurveyModule } from './survey/survey.controller';
import { UniqueLinksModule } from './unique-links/unique-links';
import { UsersModule } from './users/users.controller';
import { VendorsModule } from './vendors/vendors.controller';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    PrismaModule,
    AuditModule,
    EntitlementsModule,
    IntegrationsModule,
    SuperAdminModule,
    BillingModule,
    PushModule,
    AuthModule,
    UsersModule,
    ClientsModule,
    VendorsModule,
    ProjectsModule,
    CustomOptionsModule,
    PartyLogosModule,
    ClientLinksModule,
    NumberingModule,
    RedirectsModule,
    SurveyModule,
    CallbacksModule,
    FinanceModule,
    AccountingModule,
    TasksModule,
    ChatModule,
    AiModule,
    MonitorModule,
    QuotasModule,
    AnalyticsModule,
    DashboardModule,
    PortalModule,
    RequestsModule,
    QuotesModule, PrivacyModule, BrandingModule, RedirectHealthModule,
    VendorSignupModule,
    UniqueLinksModule,
    ReportsModule,
    WonBidsModule,
    SampleonModule,
    WebhooksModule,
    PublicApiModule,
    MailModule,
    SchedulesModule,
  ],
})
export class AppModule {}
