import { BrandingService } from '../branding/branding';
import { BadRequestException, Body, Controller, ForbiddenException, Get, HttpCode, Injectable, NotFoundException, Param, Post, Put, UnauthorizedException } from '@nestjs/common';
import { Role, User } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import * as QRCode from 'qrcode';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { config } from '../common/config';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from './auth.types';
import { AllowWithoutMfa, CurrentUser, Roles, STAFF } from './decorators';
import { decryptSecret, encryptSecret, hashRecoveryCode, newRecoveryCodes, newTotpSecret, otpauthUrl, verifyTotp } from './totp';

const ALL_ROLES: Role[] = ['ADMIN', 'PROJECT_MANAGER', 'SALES', 'VIEWER', 'CLIENT_USER', 'VENDOR_USER'];
const MAX_FAILURES = 10;
const LOCK_MS = 15 * 60_000;

export const secondFactorSchema = z
  .object({ code: z.string().trim().max(12).optional(), recoveryCode: z.string().trim().max(40).optional() })
  .refine((b) => !!b.code || !!b.recoveryCode, 'Enter the 6-digit code from your app or a recovery code');
const codeSchema = z.object({ code: z.string().trim().min(6).max(12) });
const disableSchema = z.object({ password: z.string().min(1), code: z.string().trim().max(12).optional(), recoveryCode: z.string().trim().max(40).optional() });
const orgSecuritySchema = z.object({ mfaRequired: z.boolean() });

export const isStaff = (role: Role) => STAFF.includes(role);

@Injectable()
export class MfaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly branding: BrandingService,
  ) {}

  /** What the signed-in person's two-step sign-in looks like, and whether their organization requires it. */
  async status(userId: string) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { organization: { select: { mfaRequired: true } } } });
    const required = u.organization.mfaRequired && isStaff(u.role);
    return { enabled: !!u.mfaEnabledAt, enabledAt: u.mfaEnabledAt, recoveryCodesLeft: u.mfaRecoveryCodes.length, required, setupRequired: required && !u.mfaEnabledAt };
  }

  async setup(au: AuthUser) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: au.id }, include: { organization: { select: { name: true } } } });
    if (u.mfaEnabledAt) throw new BadRequestException('Two-step sign-in is already on. Turn it off first to move to a new phone.');
    const secret = newTotpSecret();
    await this.prisma.user.update({ where: { id: u.id }, data: { mfaPendingSecret: encryptSecret(secret, config.mfaEncryptionKey) } });
    const url = otpauthUrl(secret, u.email, `${(await this.branding.brand(u.organizationId)).appName} (${u.organization.name})`);
    const qrSvg = await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
    return { secret, otpauthUrl: url, qrSvg };
  }

  /** Confirms setup with a first code. Returns the recovery codes, which are shown only now. */
  async enable(au: AuthUser, code: string) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: au.id } });
    if (u.mfaEnabledAt) throw new BadRequestException('Two-step sign-in is already on');
    if (!u.mfaPendingSecret) throw new BadRequestException('Start the setup first');
    const secret = decryptSecret(u.mfaPendingSecret, config.mfaEncryptionKey);
    const step = verifyTotp(secret, code);
    if (step === null) throw new BadRequestException('That code is not right. Check the time on your phone and try the newest code.');
    const codes = newRecoveryCodes();
    await this.prisma.user.update({
      where: { id: u.id },
      data: { mfaSecret: u.mfaPendingSecret, mfaPendingSecret: null, mfaEnabledAt: new Date(), mfaLastStep: step, mfaRecoveryCodes: codes.map(hashRecoveryCode), mfaFailures: 0, mfaLockedUntil: null },
    });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'mfa.enable', entityType: 'User', entityId: u.id });
    return { recoveryCodes: codes };
  }

  /**
   * Checks a second factor for a user who has it on. Counts failures and locks the second step
   * for 15 minutes after 10 wrong codes in a row. Codes and recovery codes work once.
   */
  async verify(u: User, input: { code?: string; recoveryCode?: string }): Promise<'code' | 'recovery'> {
    if (!u.mfaEnabledAt || !u.mfaSecret) throw new BadRequestException('Two-step sign-in is not on');
    if (u.mfaLockedUntil && u.mfaLockedUntil.getTime() > Date.now()) {
      throw new UnauthorizedException(`Too many wrong codes. Try again after ${u.mfaLockedUntil.toISOString().slice(11, 16)} UTC, or ask an admin to reset your two-step sign-in.`);
    }
    let used: 'code' | 'recovery' | null = null;
    if (input.code) {
      const step = verifyTotp(decryptSecret(u.mfaSecret, config.mfaEncryptionKey), input.code, u.mfaLastStep);
      // Guarded write: two requests with the same code cannot both pass.
      if (step !== null && (await this.prisma.$executeRaw`UPDATE "User" SET "mfaLastStep" = ${step} WHERE id = ${u.id} AND ("mfaLastStep" IS NULL OR "mfaLastStep" < ${step})`)) used = 'code';
    } else if (input.recoveryCode) {
      const h = hashRecoveryCode(input.recoveryCode);
      if (await this.prisma.$executeRaw`UPDATE "User" SET "mfaRecoveryCodes" = array_remove("mfaRecoveryCodes", ${h}) WHERE id = ${u.id} AND ${h} = ANY("mfaRecoveryCodes")`) used = 'recovery';
    }
    if (!used) {
      const failures = u.mfaFailures + 1;
      await this.prisma.user.update({ where: { id: u.id }, data: failures >= MAX_FAILURES ? { mfaFailures: 0, mfaLockedUntil: new Date(Date.now() + LOCK_MS) } : { mfaFailures: failures } });
      throw new UnauthorizedException(input.code ? 'That code is not right, or it was already used. Wait for the next code.' : 'That recovery code is not right or was already used.');
    }
    if (u.mfaFailures || u.mfaLockedUntil) await this.prisma.user.update({ where: { id: u.id }, data: { mfaFailures: 0, mfaLockedUntil: null } });
    if (used === 'recovery') await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'mfa.recovery_code_used', entityType: 'User', entityId: u.id });
    return used;
  }

  async disable(au: AuthUser, body: z.infer<typeof disableSchema>) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: au.id }, include: { organization: { select: { mfaRequired: true } } } });
    if (!u.mfaEnabledAt) return this.status(u.id);
    if (u.organization.mfaRequired && isStaff(u.role)) throw new BadRequestException('Your organization requires two-step sign-in, so it cannot be turned off. To move to a new phone, ask an admin to reset it.');
    if (!(await bcrypt.compare(body.password, u.passwordHash))) throw new UnauthorizedException('Wrong password');
    await this.verify(u, body);
    await this.clear(u.id);
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'mfa.disable', entityType: 'User', entityId: u.id });
    return this.status(u.id);
  }

  async regenerate(au: AuthUser, code: string) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: au.id } });
    await this.verify(u, { code });
    const codes = newRecoveryCodes();
    await this.prisma.user.update({ where: { id: u.id }, data: { mfaRecoveryCodes: codes.map(hashRecoveryCode) } });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'mfa.recovery_codes', entityType: 'User', entityId: u.id });
    return { recoveryCodes: codes };
  }

  clear(userId: string) {
    return this.prisma.user.update({ where: { id: userId }, data: { mfaSecret: null, mfaPendingSecret: null, mfaEnabledAt: null, mfaRecoveryCodes: [], mfaLastStep: null, mfaFailures: 0, mfaLockedUntil: null } });
  }
}

/** The signed-in person's own two-step sign-in. Reachable before setup when the organization requires it. */
@Controller('auth/mfa')
@Roles(...ALL_ROLES)
@AllowWithoutMfa()
export class MfaController {
  constructor(private readonly mfa: MfaService) {}

  @Get()
  status(@CurrentUser() u: AuthUser) {
    return this.mfa.status(u.id);
  }

  @Post('setup')
  @HttpCode(200)
  setup(@CurrentUser() u: AuthUser) {
    return this.mfa.setup(u);
  }

  @Post('enable')
  @HttpCode(200)
  enable(@CurrentUser() u: AuthUser, @Body(new ZodPipe(codeSchema)) b: z.infer<typeof codeSchema>) {
    return this.mfa.enable(u, b.code);
  }

  @Post('disable')
  @HttpCode(200)
  disable(@CurrentUser() u: AuthUser, @Body(new ZodPipe(disableSchema)) b: z.infer<typeof disableSchema>) {
    return this.mfa.disable(u, b);
  }

  @Post('recovery-codes')
  @HttpCode(200)
  regenerate(@CurrentUser() u: AuthUser, @Body(new ZodPipe(codeSchema)) b: z.infer<typeof codeSchema>) {
    return this.mfa.regenerate(u, b.code);
  }
}

/** Admin view: who has two-step sign-in, the organization rule, and resets for locked-out people. */
@Controller()
@Roles('ADMIN')
export class MfaAdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mfa: MfaService,
    private readonly audit: AuditService,
  ) {}

  @Get('organization/security')
  async get(@CurrentUser() u: AuthUser) {
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: u.organizationId }, select: { mfaRequired: true } });
    const users = await this.prisma.user.findMany({
      where: { organizationId: u.organizationId, active: true },
      select: { id: true, name: true, email: true, role: true, mfaEnabledAt: true, mfaRecoveryCodes: true, mfaLockedUntil: true },
      orderBy: [{ role: 'asc' }, { name: 'asc' }],
    });
    return {
      mfaRequired: org.mfaRequired,
      users: users.map((x) => ({
        id: x.id, name: x.name, email: x.email, role: x.role, staff: isStaff(x.role),
        mfaEnabled: !!x.mfaEnabledAt, mfaEnabledAt: x.mfaEnabledAt, recoveryCodesLeft: x.mfaRecoveryCodes.length,
        locked: !!x.mfaLockedUntil && x.mfaLockedUntil.getTime() > Date.now(),
      })),
    };
  }

  /** Turning the rule on needs the admin's own two-step sign-in first, so nobody locks the organization out. */
  @Put('organization/security')
  async put(@CurrentUser() u: AuthUser, @Body(new ZodPipe(orgSecuritySchema)) body: z.infer<typeof orgSecuritySchema>) {
    if (body.mfaRequired) {
      const me = await this.prisma.user.findUniqueOrThrow({ where: { id: u.id }, select: { mfaEnabledAt: true } });
      if (!me.mfaEnabledAt) throw new BadRequestException('Turn on two-step sign-in for your own account first');
    }
    await this.prisma.organization.update({ where: { id: u.organizationId }, data: { mfaRequired: body.mfaRequired } });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: body.mfaRequired ? 'mfa.require' : 'mfa.unrequire', entityType: 'Organization', entityId: u.organizationId });
    return this.get(u);
  }

  /** For someone who lost their phone and recovery codes. They set it up again at next sign-in. */
  @Post('users/:id/mfa/reset')
  @HttpCode(200)
  async reset(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    if (id === u.id) throw new ForbiddenException('Use your own security page to change your two-step sign-in');
    const target = await this.prisma.user.findFirst({ where: { id, organizationId: u.organizationId } });
    if (!target) throw new NotFoundException('User not found');
    await this.mfa.clear(id);
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'mfa.reset', entityType: 'User', entityId: id, detail: { email: target.email } });
    return { ok: true };
  }
}
