import { EntitlementsService } from '../super-admin/entitlements';
/**
 * Public vendor sign-up (spec module 9). An organisation turns on a sign-up link; panel companies
 * apply through it; staff approve (creating the vendor, its markets and a portal login with an
 * emailed invite) or reject.
 *
 * Abuse controls, all free: a built-in arithmetic check signed by the server (nothing stored), a
 * hidden honeypot field, a minimum time on the page, five applications per IP per hour, and one
 * pending application per email. Nothing is emailed to the applicant until staff approve, so the
 * form cannot be used to send mail to strangers.
 */
import { BadRequestException, Body, Controller, Delete, Get, HttpException, HttpStatus, Injectable, Module, NotFoundException, Param, Post, Put, Query, Req } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { Request } from 'express';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { AuthModule } from '../auth/auth.module';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser, EDITORS, Public, Roles } from '../auth/decorators';
import { PasswordService } from '../auth/password.service';
import { config } from '../common/config';
import { hmacSha256, randomToken, sha256 } from '../common/crypto';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { RateLimiter } from '../public-api/api-key.guard';
import { humanChallenge, normaliseAnswer } from '../survey/captcha';

export const SPECIALTIES = ['B2C', 'B2B', 'HEALTHCARE', 'AUTOMOTIVE', 'FINANCE', 'GAMING', 'YOUTH', 'ETHNIC', 'MOBILE'] as const;
/** Seconds a person needs at least to fill the form; faster submissions are scripts. */
const MIN_FILL_SECONDS = 3;
const CHALLENGE_MINUTES = 30;
export const signupLimiter = new RateLimiter(5, 3_600_000);

const country = z.string().regex(/^[A-Z]{2}$/);
const applySchema = z
  .object({
    companyName: z.string().trim().min(2).max(160),
    website: z.string().trim().url().max(300).refine((u) => /^https?:\/\//i.test(u), 'Use an http(s) address').optional().or(z.literal('').transform(() => undefined)),
    contactName: z.string().trim().min(2).max(120),
    email: z.string().trim().email().max(200).transform((s) => s.toLowerCase()),
    phone: z.string().trim().max(40).optional(),
    countries: z.array(country).min(1).max(120),
    panelSize: z.coerce.number().int().min(0).max(1_000_000_000).optional(),
    specialties: z.array(z.enum(SPECIALTIES)).max(SPECIALTIES.length).default([]),
    message: z.string().trim().max(3000).optional(),
    challenge: z.string().max(300),
    answer: z.string().max(20),
    /** Honeypot: hidden from people, filled by bots. */
    homepage: z.string().max(300).optional(),
  })
  .strict();

const secret = () => `${config.jwtSecret}:vendor-signup`;

/** A math question and a signed token carrying its seed and time; the answer is never sent. */
export function newChallenge(orgId: string, now = Date.now()) {
  const nonce = randomToken(12);
  const token = `${nonce}.${now}`;
  const sig = hmacSha256(secret(), `${orgId}:${token}`).slice(0, 32);
  const c = humanChallenge('math', secret(), `${orgId}:${nonce}`, 0);
  return { token: `${token}.${sig}`, question: c.text };
}

export function checkChallenge(orgId: string, token: string, answer: string, now = Date.now()): string | null {
  const [nonce, ts, sig] = token.split('.');
  if (!nonce || !ts || !sig || hmacSha256(secret(), `${orgId}:${nonce}.${ts}`).slice(0, 32) !== sig) return 'The check expired; reload the page';
  const age = now - Number(ts);
  if (!(age >= 0) || age > CHALLENGE_MINUTES * 60_000) return 'The check expired; reload the page';
  if (age < MIN_FILL_SECONDS * 1000) return 'Please take a moment to fill the form';
  const expected = humanChallenge('math', secret(), `${orgId}:${nonce}`, 0).answer;
  return normaliseAnswer(answer) === expected ? null : 'The answer to the check is not right';
}

@Injectable()
export class VendorSignupService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly passwords: PasswordService, private readonly entitlements: EntitlementsService) {}

  async orgByToken(token: string) {
    if (!/^[A-Za-z0-9_-]{16,80}$/.test(token)) throw new NotFoundException('This sign-up link does not work');
    const org = await this.prisma.organization.findUnique({ where: { vendorSignupToken: token }, select: { id: true, name: true } });
    if (!org) throw new NotFoundException('This sign-up link does not work');
    return org;
  }

  async apply(token: string, body: z.infer<typeof applySchema>, ip: string | undefined) {
    const org = await this.orgByToken(token);
    if (!signupLimiter.hit(`${org.id}:${ip ?? '?'}`).ok) throw new HttpException('Too many applications from your network; try again in an hour', HttpStatus.TOO_MANY_REQUESTS);
    // Bots that fill the hidden field get the same answer as people, and nothing is stored.
    if (body.homepage) return { ok: true };
    const problem = checkChallenge(org.id, body.challenge, body.answer);
    if (problem) throw new BadRequestException(problem);
    const pending = await this.prisma.vendorApplication.findFirst({ where: { organizationId: org.id, email: body.email, status: 'PENDING' } });
    if (pending) return { ok: true };
    const a = await this.prisma.vendorApplication.create({
      data: {
        organizationId: org.id,
        companyName: body.companyName,
        website: body.website ?? null,
        contactName: body.contactName,
        email: body.email,
        phone: body.phone || null,
        countries: [...new Set(body.countries)],
        panelSize: body.panelSize ?? null,
        specialties: [...new Set(body.specialties)],
        message: body.message || null,
        ipHash: ip ? sha256(`${org.id}:${ip}`) : null,
      },
    });
    await this.audit.record({ organizationId: org.id, actorId: null, action: 'vendor-application.create', entityType: 'VendorApplication', entityId: a.id, detail: { company: a.companyName, countries: a.countries.length } });
    return { ok: true };
  }

  async approve(u: AuthUser, id: string, b: { code: string; name?: string; createLogin: boolean }) {
    const a = await this.prisma.vendorApplication.findFirst({ where: { id, organizationId: u.organizationId } });
    if (!a) throw new NotFoundException('Application not found');
    if (a.status !== 'PENDING') throw new BadRequestException('This application was already reviewed');
    await this.entitlements.assertLimit(u.organizationId, 'vendors');
    if (b.createLogin) await this.entitlements.assertLimit(u.organizationId, 'portalUsers');
    if (await this.prisma.vendor.findFirst({ where: { organizationId: u.organizationId, code: b.code } })) throw new BadRequestException(`Vendor code ${b.code} is taken`);
    if (b.createLogin && (await this.prisma.user.count({ where: { organizationId: u.organizationId, email: a.email } }))) {
      throw new BadRequestException(`Someone with ${a.email} already has a login; approve without a login and link it from Portal access`);
    }
    const { vendor, user } = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.vendorApplication.updateMany({ where: { id: a.id, status: 'PENDING' }, data: { status: 'APPROVED', reviewedById: u.id, reviewedAt: new Date() } });
      if (!claimed.count) throw new BadRequestException('This application was already reviewed');
      const vendor = await tx.vendor.create({
        data: {
          organizationId: u.organizationId,
          name: b.name?.trim() || a.companyName,
          code: b.code,
          callbackSecret: randomToken(32),
          capacity: { create: a.countries.map((countryCode) => ({ countryCode, note: a.panelSize ? `Applied with ${a.panelSize.toLocaleString('en')} panel members` : 'From sign-up' })) },
        },
      });
      await tx.vendorApplication.update({ where: { id: a.id }, data: { vendorId: vendor.id } });
      const user = b.createLogin
        ? await tx.user.create({
            data: { organizationId: u.organizationId, email: a.email, name: a.contactName, role: 'VENDOR_USER', vendorId: vendor.id, passwordHash: await bcrypt.hash(randomToken(32), 10) },
            include: { organization: true },
          })
        : null;
      return { vendor, user };
    });
    let invite: { emailed: boolean; inviteUrl: string } | null = null;
    if (user) {
      const link = await this.passwords.issue(user, 'invite', u.id);
      invite = { emailed: await this.passwords.email(user, 'invite', link, u.name), inviteUrl: link.url };
    }
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'vendor-application.approve', entityType: 'VendorApplication', entityId: a.id, detail: { vendorId: vendor.id, login: !!user, emailed: invite?.emailed ?? false } });
    return { vendor: { id: vendor.id, name: vendor.name, code: vendor.code }, invite };
  }

  async reject(u: AuthUser, id: string, reason?: string) {
    const r = await this.prisma.vendorApplication.updateMany({ where: { id, organizationId: u.organizationId, status: 'PENDING' }, data: { status: 'REJECTED', reviewedById: u.id, reviewedAt: new Date(), rejectReason: reason?.trim() || null } });
    if (!r.count) throw new BadRequestException('Application not found or already reviewed');
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'vendor-application.reject', entityType: 'VendorApplication', entityId: id, detail: { reason: reason ?? null } });
    return { ok: true };
  }
}


/** An existing vendor with the same name, or with a portal login on the applicant's email. */
function similar(known: { id: string; name: string; users: { email: string }[] }[], r: { companyName: string; email: string }) {
  const v = known.find((k) => k.name.toLowerCase() === r.companyName.toLowerCase() || k.users.some((x) => x.email === r.email));
  return v ? { id: v.id, name: v.name } : null;
}

/** The public form. */
@Public()
@Controller('public/vendor-signup')
export class VendorSignupPublicController {
  constructor(private readonly svc: VendorSignupService) {}

  @Get(':token')
  async form(@Param('token') token: string) {
    const org = await this.svc.orgByToken(token);
    return { organization: org.name, specialties: SPECIALTIES, challenge: newChallenge(org.id) };
  }

  @Post(':token')
  apply(@Param('token') token: string, @Body(new ZodPipe(applySchema)) body: z.infer<typeof applySchema>, @Req() req: Request) {
    return this.svc.apply(token, body, req.ip);
  }
}

const approveSchema = z
  .object({ code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{2,20}$/, 'Use 2–20 letters, digits, - or _'), name: z.string().trim().max(160).optional(), createLogin: z.boolean().default(true) })
  .strict();

/** Staff: review applications and manage the sign-up link. */
@Controller('vendor-applications')
export class VendorApplicationsController {
  constructor(private readonly svc: VendorSignupService, private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  @Get()
  async list(@CurrentUser() u: AuthUser, @Query('status') status?: string) {
    const s = status === 'APPROVED' || status === 'REJECTED' || status === 'PENDING' ? status : undefined;
    const rows = await this.prisma.vendorApplication.findMany({
      where: { organizationId: u.organizationId, ...(s ? { status: s } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 300,
      include: { vendor: { select: { id: true, name: true, code: true } } },
    });
    // Repeat submissions from one network are worth a second look.
    const hashes = [...new Set(rows.map((r) => r.ipHash).filter((x): x is string => !!x))];
    const counts = hashes.length ? await this.prisma.vendorApplication.groupBy({ by: ['ipHash'], where: { organizationId: u.organizationId, ipHash: { in: hashes } }, _count: { _all: true } }) : [];
    const byIp = new Map(counts.map((c) => [c.ipHash!, c._count._all]));
    const known = await this.prisma.vendor.findMany({ where: { organizationId: u.organizationId }, select: { id: true, name: true, users: { select: { email: true } } } });
    return rows.map(({ ipHash, ...r }) => ({
      ...r,
      sameNetwork: ipHash ? (byIp.get(ipHash) ?? 1) - 1 : 0,
      similarVendor: similar(known, r),
    }));
  }

  @Get('link')
  async link(@CurrentUser() u: AuthUser) {
    const o = await this.prisma.organization.findUniqueOrThrow({ where: { id: u.organizationId }, select: { vendorSignupToken: true } });
    return { enabled: !!o.vendorSignupToken, url: o.vendorSignupToken ? `${config.webOrigins[0] ?? ''}/join/${o.vendorSignupToken}` : null };
  }

  @Put('link')
  @Roles('ADMIN')
  async enable(@CurrentUser() u: AuthUser) {
    await this.prisma.organization.update({ where: { id: u.organizationId }, data: { vendorSignupToken: randomToken(18) } });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'vendor-signup.link', entityType: 'Organization', entityId: u.organizationId, detail: { enabled: true } });
    return this.link(u);
  }

  @Delete('link')
  @Roles('ADMIN')
  async disable(@CurrentUser() u: AuthUser) {
    await this.prisma.organization.update({ where: { id: u.organizationId }, data: { vendorSignupToken: null } });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'vendor-signup.link', entityType: 'Organization', entityId: u.organizationId, detail: { enabled: false } });
    return this.link(u);
  }

  @Post(':id/approve')
  @Roles(...EDITORS)
  approve(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(approveSchema)) b: z.infer<typeof approveSchema>) {
    return this.svc.approve(u, id, b);
  }

  @Post(':id/reject')
  @Roles(...EDITORS)
  reject(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(z.object({ reason: z.string().max(500).optional() }).strict())) b: { reason?: string }) {
    return this.svc.reject(u, id, b.reason);
  }
}

@Module({ imports: [AuthModule], controllers: [VendorSignupPublicController, VendorApplicationsController], providers: [VendorSignupService] })
export class VendorSignupModule {}

