import { Controller, Get, Module, Query } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';
import { ZodPipe } from '../common/zod.pipe';
import { CURRENCY_NOTE, filterSchema, GROUPS, listSchema, ReportFilter, ReportsService } from './reports.service';

const groupSchema = z.object({ groupBy: z.enum(GROUPS).default('client') });
type List = z.infer<typeof listSchema>;

/** Staff-only (the global guard's default). Portal users get their own scoped views in the portal module. */
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('options')
  options(@CurrentUser() u: AuthUser) {
    return this.reports.options(u.organizationId);
  }

  @Get('overall')
  overall(@CurrentUser() u: AuthUser, @Query(new ZodPipe(filterSchema)) f: ReportFilter) {
    return this.reports.overall(u.organizationId, f);
  }

  /** Grouped report. The client report is groupBy=client, the vendor report groupBy=vendor or vendor_country. */
  @Get('summary')
  async summary(@CurrentUser() u: AuthUser, @Query(new ZodPipe(filterSchema)) f: ReportFilter, @Query(new ZodPipe(groupSchema)) g: z.infer<typeof groupSchema>) {
    const [rows, totals] = await Promise.all([this.reports.summary(u.organizationId, f, g.groupBy), this.reports.summary(u.organizationId, f, null)]);
    return { groupBy: g.groupBy, rows, totals: totals[0] ?? null, currencyNote: CURRENCY_NOTE };
  }

  @Get('conversion')
  conversion(@CurrentUser() u: AuthUser, @Query(new ZodPipe(filterSchema)) f: ReportFilter, @Query(new ZodPipe(listSchema)) l: List) {
    return this.reports.conversion(u.organizationId, f, l);
  }

  @Get('clicks')
  clicks(@CurrentUser() u: AuthUser, @Query(new ZodPipe(filterSchema)) f: ReportFilter, @Query(new ZodPipe(listSchema)) l: List) {
    return this.reports.clicks(u.organizationId, f, l);
  }
}

@Module({ controllers: [ReportsController], providers: [ReportsService], exports: [ReportsService] })
export class ReportsModule {}
