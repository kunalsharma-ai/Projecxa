import { Body, Controller, Get, Module, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, EDITORS, Roles } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';
import { ZodPipe } from '../common/zod.pipe';
import { createInvoiceSchema, FinanceService, invoiceListSchema, reconcileSchema, updateInvoiceSchema } from './finance.service';
import { billListSchema, createBillsSchema, financeSettingsSchema, PayablesService, updateBillSchema } from './payables.service';

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

/** Vendor payables and finance settings (docs/PAYABLES.md). */
@Controller()
export class PayablesController {
  constructor(private readonly payables: PayablesService) {}

  @Get('payables/summary')
  summary(@CurrentUser() u: AuthUser) {
    return this.payables.summary(u.organizationId);
  }

  @Post('payables/bills')
  @Roles(...EDITORS)
  create(@CurrentUser() u: AuthUser, @Body(new ZodPipe(createBillsSchema)) body: z.infer<typeof createBillsSchema>) {
    return this.payables.createBills(u, body);
  }

  @Get('payables/bills')
  list(@CurrentUser() u: AuthUser, @Query(new ZodPipe(billListSchema)) q: z.infer<typeof billListSchema>) {
    return this.payables.list(u.organizationId, q);
  }

  @Get('payables/bills/:id')
  get(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.payables.get(u.organizationId, id);
  }

  @Patch('payables/bills/:id')
  @Roles(...EDITORS)
  update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(updateBillSchema)) body: z.infer<typeof updateBillSchema>) {
    return this.payables.update(u, id, body);
  }

  @Get('organization/finance-settings')
  settings(@CurrentUser() u: AuthUser) {
    return this.payables.settings(u.organizationId);
  }

  @Put('organization/finance-settings')
  @Roles('ADMIN')
  saveSettings(@CurrentUser() u: AuthUser, @Body(new ZodPipe(financeSettingsSchema)) body: z.infer<typeof financeSettingsSchema>) {
    return this.payables.saveSettings(u, body);
  }
}

@Module({ controllers: [FinanceController, PayablesController], providers: [FinanceService, PayablesService], exports: [FinanceService, PayablesService] })
export class FinanceModule {}
