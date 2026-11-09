import { EntitlementsService } from '../super-admin/entitlements';
import { Body, Controller, Get, Headers, HttpCode, Param, Post, Put, Query, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request, Response } from 'express';
import { z } from 'zod';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser, Public, Roles } from '../auth/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { BillingService, MAX_PROOF_BYTES, OFFLINE_METHODS } from './billing.service';

const interval = z.enum(['MONTHLY', 'YEARLY']);
const planCode = z.string().trim().min(1).max(40);
const text = (n: number) => z.string().trim().max(n);
const checkout = z.object({ planCode, interval, provider: z.enum(['razorpay', 'stripe']) }).strict();
const razorpayVerify = z.object({ invoiceId: z.string().max(40), orderId: z.string().max(80), paymentId: z.string().max(80), signature: z.string().max(200) }).strict();
const offline = z.object({
  planCode, interval, method: z.enum(OFFLINE_METHODS), reference: text(120).min(2, 'Enter the transaction or cheque reference'),
  paidOn: z.coerce.date(), note: text(1000).optional().nullable(),
});
const settings = z.object({
  onlineEnabled: z.boolean(), offlineEnabled: z.boolean(), offlineMethods: z.array(z.enum(OFFLINE_METHODS)).max(5),
  bankDetails: text(2000).nullable(), upiId: text(100).nullable(), offlineInstructions: text(2000).nullable(),
  taxName: text(40).nullable(), taxPercent: z.number().min(0).max(100),
  sellerName: text(160).nullable(), sellerAddress: text(1000).nullable(), sellerTaxId: text(60).nullable(), sellerEmail: text(200).nullable(), invoiceFooter: text(1000).nullable(),
}).partial().strict();
const record = z.object({
  organizationId: z.string().max(40), planCode, interval, amount: z.number().min(0).max(100_000_000).nullable().optional(),
  method: z.enum([...OFFLINE_METHODS, 'razorpay', 'stripe']), reference: text(120).nullable().optional(), paidOn: z.coerce.date().nullable().optional(), note: text(1000).nullable().optional(),
}).strict();
const review = z.object({ note: text(1000).nullable().optional() }).strict();
const rejectBody = z.object({ note: text(1000).min(2, 'Say why, so they can fix it') }).strict();
const STATUSES = ['OPEN', 'PENDING_REVIEW', 'PAID', 'REJECTED', 'CANCELLED'] as const;

function send(res: Response, f: { name: string; type: string; data: Buffer }, inline = false) {
  const ascii = f.name.replace(/[^\w.() -]/g, '_');
  res.set({
    'Content-Type': f.type,
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(f.name)}`,
    'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'", 'Cache-Control': 'no-store',
  });
  res.send(f.data);
}

/**
 * The organisation's own plan and payments (admins). Works while the subscription has ended, so it can be renewed
 * (auth.guard.ts lets billing/ through SUBSCRIPTION_INACTIVE).
 */
@Controller('billing')
@Roles('ADMIN')
export class BillingController {
  constructor(private readonly billing: BillingService, private readonly entitlements: EntitlementsService) {}

  @Get() overview(@CurrentUser() u: AuthUser) { return this.billing.overview(u); }
  /** The plan's usage limits and how much is used (docs/PLAN_LIMITS.md). */
  @Get('usage') usage(@CurrentUser() u: AuthUser) { return this.entitlements.limitsReport(u.organizationId); }

  @Post('checkout') @HttpCode(200)
  checkout(@CurrentUser() u: AuthUser, @Body(new ZodPipe(checkout)) b: z.infer<typeof checkout>) { return this.billing.checkout(u, b); }

  @Post('razorpay/verify') @HttpCode(200)
  razorpayVerify(@CurrentUser() u: AuthUser, @Body(new ZodPipe(razorpayVerify)) b: z.infer<typeof razorpayVerify>) { return this.billing.razorpayVerify(u, b); }

  @Post('stripe/confirm') @HttpCode(200)
  stripeConfirm(@CurrentUser() u: AuthUser, @Body(new ZodPipe(z.object({ invoiceId: z.string().max(40) }).strict())) b: { invoiceId: string }) { return this.billing.stripeConfirm(u, b.invoiceId); }

  @Post('offline')
  @UseInterceptors(FileInterceptor('proof', { limits: { fileSize: MAX_PROOF_BYTES + 1, files: 1, fields: 10, fieldSize: 4000 } }))
  offline(@CurrentUser() u: AuthUser, @Body(new ZodPipe(offline)) b: z.infer<typeof offline>, @UploadedFile() file?: { originalname: string; mimetype: string; size: number; buffer: Buffer }) {
    return this.billing.submitOffline(u, b, file);
  }

  @Post('invoices/:id/cancel') @HttpCode(200)
  cancel(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.billing.cancel(u, id); }

  @Get('invoices/:id/pdf')
  async pdf(@CurrentUser() u: AuthUser, @Param('id') id: string, @Res() res: Response) {
    const f = await this.billing.myPdf(u, id);
    send(res, { name: f.name, type: 'application/pdf', data: f.pdf });
  }
}

/** Super Admin → Billing (the guard checks the Super Admin for every super-admin/ route). */
@Controller('super-admin/billing')
@Roles('ADMIN')
export class BillingAdminController {
  constructor(private readonly billing: BillingService) {}

  @Get()
  list(@Query('status') status?: string, @Query('organizationId') organizationId?: string) {
    return this.billing.adminList({ status: (STATUSES as readonly string[]).includes(status ?? '') ? (status as (typeof STATUSES)[number]) : undefined, organizationId: organizationId?.slice(0, 40) || undefined });
  }
  @Get('settings') settings() { return this.billing.settings(); }
  @Put('settings') save(@CurrentUser() u: AuthUser, @Body(new ZodPipe(settings)) b: z.infer<typeof settings>) { return this.billing.saveSettings(u, b); }
  @Post('payments') record(@CurrentUser() u: AuthUser, @Body(new ZodPipe(record)) b: z.infer<typeof record>) { return this.billing.record(u, b); }
  @Post('invoices/:id/confirm') @HttpCode(200)
  confirm(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(review)) b: z.infer<typeof review>) { return this.billing.confirm(u, id, b.note); }
  @Post('invoices/:id/reject') @HttpCode(200)
  reject(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(rejectBody)) b: z.infer<typeof rejectBody>) { return this.billing.reject(u, id, b.note); }
  @Post('invoices/:id/cancel') @HttpCode(200)
  cancel(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.billing.adminCancel(u, id); }
  @Get('invoices/:id/proof')
  async proof(@Param('id') id: string, @Res() res: Response) {
    const p = await this.billing.proof(id);
    send(res, { name: p.name, type: p.type, data: p.data });
  }
  @Get('invoices/:id/pdf')
  async pdf(@Param('id') id: string, @Res() res: Response) {
    const f = await this.billing.adminPdf(id);
    send(res, { name: f.name, type: 'application/pdf', data: f.pdf });
  }
}

/** Gateways tell SampTrek about payments here; each request is checked with the gateway's webhook secret. */
@Controller('public/billing')
@Public()
export class BillingWebhookController {
  constructor(private readonly billing: BillingService) {}

  @Post('razorpay/webhook') @HttpCode(200)
  razorpay(@Req() req: Request & { rawBody?: Buffer }, @Headers('x-razorpay-signature') sig?: string) { return this.billing.razorpayWebhook(req.rawBody, sig); }

  @Post('stripe/webhook') @HttpCode(200)
  stripe(@Req() req: Request & { rawBody?: Buffer }, @Headers('stripe-signature') sig?: string) { return this.billing.stripeWebhook(req.rawBody, sig); }
}
