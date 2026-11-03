import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AuditModule } from './audit/audit.service';
import { AuthModule } from './auth/auth.module';
import { CallbacksModule } from './callbacks/callbacks.service';
import { ClientsModule } from './clients/clients.controller';
import { DashboardModule } from './dashboard/dashboard.controller';
import { FinanceModule } from './finance/finance.controller';
import { PortalModule } from './portal/portal.controller';
import { ReportsModule } from './reports/reports.controller';
import { WonBidsModule } from './won-bids/won-bids.controller';
import { PrismaModule } from './prisma/prisma.service';
import { ProjectsModule } from './projects/projects.controller';
import { RedirectsModule } from './redirects/redirects.controller';
import { SurveyModule } from './survey/survey.controller';
import { UsersModule } from './users/users.controller';
import { VendorsModule } from './vendors/vendors.controller';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    PrismaModule,
    AuditModule,
    AuthModule,
    UsersModule,
    ClientsModule,
    VendorsModule,
    ProjectsModule,
    RedirectsModule,
    SurveyModule,
    CallbacksModule,
    FinanceModule,
    DashboardModule,
    PortalModule,
    ReportsModule,
    WonBidsModule,
  ],
})
export class AppModule {}
