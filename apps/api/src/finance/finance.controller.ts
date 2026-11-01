import { Body, Controller, Get, Module, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, EDITORS, Roles } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';
import { ZodPipe } from '../common/zod.pipe';
import { createInvoiceSchema, FinanceService, invoiceListSchema, reconcileSchema, updateInvoiceSchema } from './finance.service';

@Controller()
export class FinanceController {
  constructor(private readonly finance: FinanceService) {}

  @Get('projects/:id/reconciliation')
  summary(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.finance.reconciliationSummary(u, id);
  }

  /** Dry run: what the pasted list would change. Nothing is saved. */
  @Post('projects/:id/reconciliation/preview')
  @Roles(...EDITORS)
  preview(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(reconcileSchema)) body: z.infer<typeof reconcileSchema>) {
    return this.finance.reconcile(u, id, body, false);
  }

  @Post('projects/:id/reconciliation')
  @Roles(...EDITORS)
  apply(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(reconcileSchema)) body: z.infer<typeof reconcileSchema>) {
    return this.finance.reconcile(u, id, body, true);
  }

  @Post('projects/:id/invoices')
  @Roles(...EDITORS)
  createInvoices(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(createInvoiceSchema)) body: z.infer<typeof createInvoiceSchema>) {
    return this.finance.createInvoices(u, id, body.notes);
  }

  @Get('invoices')
  list(@CurrentUser() u: AuthUser, @Query(new ZodPipe(invoiceListSchema)) q: z.infer<typeof invoiceListSchema>) {
    return this.finance.listInvoices(u, q);
  }

  @Get('invoices/:id')
  get(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.finance.getInvoice(u, id);
  }

  @Patch('invoices/:id')
  @Roles(...EDITORS)
  update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(updateInvoiceSchema)) body: z.infer<typeof updateInvoiceSchema>) {
    return this.finance.updateInvoice(u, id, body);
  }
}

@Module({ controllers: [FinanceController], providers: [FinanceService], exports: [FinanceService] })
export class FinanceModule {}
