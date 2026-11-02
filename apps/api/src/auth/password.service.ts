import { BadRequestException, Body, Controller, ForbiddenException, Get, HttpCode, Injectable, Logger, NotFoundException, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { Organization, Prisma, Role, User } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { config } from '../common/config';
import { randomToken, sha256 } from '../common/crypto';
import { ZodPipe } from '../common/zod.pipe';
import { MailNotConfigured, MailService } from '../mail/mail.service';
import { BrandingService, emailHeader, webBaseOf } from '../branding/branding';
import { PrismaService } from '../prisma/prisma.service';
import { passwordBlocked } from './auth.controller';
import { AuthUser } from './auth.types';
import { AllowWithoutMfa, CurrentUser, Public, Roles } from './decorators';
import { SessionService } from './session.service';

/** Passwords: at least 10 characters, not only digits, and not the email. */
export const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(200)
  .refine((p) => !/^\d+$/.test(p), 'Use more than digits');

const INVITE_HOURS = 72;
const RESET_MINUTES = 30;
/** Reset emails per person per hour, so the form cannot be used to flood someone's inbox. */
const RESETS_PER_HOUR = 3;
const STAFF: Role[] = ['ADMIN', 'PROJECT_MANAGER', 'SALES', 'VIEWER'];
const ROLE_LABEL: Record<string, string> = { ADMIN: 'Admin', PROJECT_MANAGER: 'Project manager', SALES: 'Sales', VIEWER: 'Viewer', CLIENT_USER: 'Client portal', VENDOR_USER: 'Vendor portal' };

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

type Purpose = 'invite' | 'reset';
type UserWithOrg = User & { organization: Organization };

@Injectable()
export class PasswordService {
  private readonly log = new Logger(PasswordService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
    private readonly branding: BrandingService,
  ) {}

  /** Makes a new one-time link (earlier unused links for the same person stop working). */
  async issue(user: UserWithOrg, purpose: Purpose, by: string | null) {
    const token = randomToken(32);
    const expiresAt = new Date(Date.now() + (purpose === 'invite' ? INVITE_HOURS * 3_600_000 : RESET_MINUTES * 60_000));
    await this.prisma.$transaction([
      this.prisma.passwordToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } }),
      this.prisma.passwordToken.create({ data: { userId: user.id, purpose, tokenHash: sha256(token), expiresAt, createdById: by } }),
    ]);
    return { url: `${webBaseOf(user.organization)}/set-password?token=${token}`, expiresAt };
  }

  /** Sends the link. Returns whether the email went out; an invite still works by copying the link. */
  async email(user: UserWithOrg, purpose: Purpose, link: { url: string; expiresAt: Date }, invitedBy?: string) {
    const org = user.organization.name;
    const brand = await this.branding.brand(user.organizationId);
    const app = brand.appName;
    const color = brand.brandColor ?? '#1d4ed8';
    const subject = purpose === 'invite' ? `You're invited to ${org} on ${app}` : `Reset your ${app} password`;
    const lead = purpose === 'invite'
      ? `${invitedBy ?? 'Your admin'} added you to ${org} on ${app} as ${ROLE_LABEL[user.role] ?? user.role}. Choose a password to start.`
      : `Someone asked to reset the password for ${user.email} on ${app} (${org}). If it was you, choose a new password. If not, you can ignore this email; your password stays the same.`;
    const valid = purpose === 'invite' ? `The link works for ${INVITE_HOURS} hours.` : `The link works for ${RESET_MINUTES} minutes and only once.`;
    const button = purpose === 'invite' ? 'Choose a password' : 'Reset password';
    const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:520px;margin:auto;color:#0f172a">
${emailHeader(brand)}
<p>Hi ${esc(user.name)},</p><p>${esc(lead)}</p>
<p style="margin:28px 0"><a href="${esc(link.url)}" style="background:${color};color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">${button}</a></p>
<p style="font-size:13px;color:#475569">${valid} If the button does not work, paste this into your browser:<br><span style="word-break:break-all">${esc(link.url)}</span></p>${brand.supportEmail ? `<p style="font-size:13px;color:#475569">Questions? Write to ${esc(brand.supportEmail)}.</p>` : ''}</div>`;
    const text = `Hi ${user.name},\n\n${lead}\n\n${button}: ${link.url}\n\n${valid}\n`;
    try {
      await this.mail.send({ to: [user.email], subject, html, text, fromName: brand.emailFromName, replyTo: brand.emailReplyTo ?? brand.supportEmail });
      return true;
    } catch (e) {
      if (!(e instanceof MailNotConfigured)) this.log.warn(`Could not send ${purpose} email: ${(e as Error).message}`);
      return false;
    }
  }

  /** "Forgot password": the answer never says whether the email exists. */
  async forgot(email: string, orgSlug?: string) {
    const users = await this.prisma.user.findMany({ where: { email, active: true, ...(orgSlug ? { organization: { slug: orgSlug } } : {}) }, include: { organization: true } });
    for (const u of users) {
      if (passwordBlocked(u)) continue; // signs in with Google, Microsoft or Zoho only
      const recent = await this.prisma.passwordToken.count({ where: { userId: u.id, purpose: 'reset', createdAt: { gte: new Date(Date.now() - 3_600_000) } } });
      if (recent >= RESETS_PER_HOUR) continue;
      const link = await this.issue(u, 'reset', null);
      await this.email(u, 'reset', link);
      await this.audit.record({ organizationId: u.organizationId, actorId: null, action: 'password.reset_requested', entityType: 'User', entityId: u.id });
    }
  }

  private async find(token: string) {
    const t = await this.prisma.passwordToken.findUnique({ where: { tokenHash: sha256(token) }, include: { user: { include: { organization: true } } } });
    if (!t || t.usedAt || t.expiresAt < new Date() || !t.user.active) throw new BadRequestException('This link has expired or was already used. Ask for a new one.');
    return t;
  }

  async check(token: string) {
    const t = await this.find(token);
    return { purpose: t.purpose, name: t.user.name, email: t.user.email, organization: t.user.organization.name, mfa: !!t.user.mfaEnabledAt };
  }

  /** Sets the password, uses up the link and signs out every existing session. */
  async set(token: string, password: string) {
    const t = await this.find(token);
    if (password.toLowerCase().includes(t.user.email.split('@')[0].toLowerCase()) && t.user.email.split('@')[0].length >= 4) throw new BadRequestException('Do not use your email in the password');
    const hash = await bcrypt.hash(password, 10);
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const used = await tx.passwordToken.updateMany({ where: { id: t.id, usedAt: null }, data: { usedAt: now } });
      if (used.count !== 1) throw new BadRequestException('This link has expired or was already used. Ask for a new one.');
      await tx.user.update({ where: { id: t.userId }, data: { passwordHash: hash, passwordSetAt: now, sessionsValidAfter: now } });
      await this.audit.record({ organizationId: t.user.organizationId, actorId: t.userId, action: t.purpose === 'invite' ? 'password.invite_accepted' : 'password.reset', entityType: 'User', entityId: t.userId }, tx);
    });
    return { ok: true, email: t.user.email, organization: t.user.organization.slug };
  }

  async change(u: AuthUser, current: string, next: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    if (!(await bcrypt.compare(current, user.passwordHash))) throw new BadRequestException('Your current password is not right');
    const now = new Date();
    await this.prisma.user.update({ where: { id: u.id }, data: { passwordHash: await bcrypt.hash(next, 10), passwordSetAt: now, sessionsValidAfter: now } });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'password.change', entityType: 'User', entityId: u.id });
    return this.prisma.user.findUniqueOrThrow({ where: { id: u.id }, include: { organization: true } });
  }
}

const forgotSchema = z.object({ email: z.string().email().transform((s) => s.toLowerCase()), organization: z.string().trim().max(80).optional() }).strict();
const setSchema = z.object({ token: z.string().min(20).max(200), password: passwordSchema }).strict();
const changeSchema = z.object({ currentPassword: z.string().min(1).max(200), newPassword: passwordSchema }).strict();

@Controller('auth/password')
@AllowWithoutMfa()
export class PasswordController {
  constructor(
    private readonly passwords: PasswordService,
    private readonly session: SessionService,
  ) {}

  @Public()
  @Post('forgot')
  @HttpCode(200)
  async forgot(@Body(new ZodPipe(forgotSchema)) body: z.infer<typeof forgotSchema>) {
    await this.passwords.forgot(body.email, body.organization || undefined);
    return { ok: true, message: 'If that email has a PROJEXA account, a reset link is on its way. It works for 30 minutes.' };
  }

  @Public()
  @Get('token')
  check(@Query('token') token: string) {
    return this.passwords.check(String(token ?? ''));
  }

  @Public()
  @Post('set')
  @HttpCode(200)
  set(@Body(new ZodPipe(setSchema)) body: z.infer<typeof setSchema>) {
    return this.passwords.set(body.token, body.password);
  }

  /** Signed in: change your own password. Other sessions are signed out; this one gets a fresh sign-in. */
  @Post('change')
  @HttpCode(200)
  @Roles('ADMIN', 'PROJECT_MANAGER', 'SALES', 'VIEWER', 'CLIENT_USER', 'VENDOR_USER')
  async change(@CurrentUser() u: AuthUser, @Body(new ZodPipe(changeSchema)) body: z.infer<typeof changeSchema>, @Res({ passthrough: true }) res: Response) {
    const user = await this.passwords.change(u, body.currentPassword, body.newPassword);
    const { token } = await this.session.start(user, res);
    return { ok: true, token };
  }
}

// ───────────── Team (staff users), admins only ─────────────

const roleEnum = z.enum(['ADMIN', 'PROJECT_MANAGER', 'SALES', 'VIEWER']);
const inviteSchema = z.object({ email: z.string().trim().email().transform((s) => s.toLowerCase()), name: z.string().trim().min(1).max(120), role: roleEnum }).strict();
const updateSchema = z
  .object({ name: z.string().trim().min(1).max(120).optional(), role: roleEnum.optional(), active: z.boolean().optional() })
  .strict()
  .refine((b) => Object.values(b).some((v) => v !== undefined), { message: 'Nothing to change' });

@Controller('team')
@Roles('ADMIN')
export class TeamController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list(@CurrentUser() u: AuthUser) {
    const users = await this.prisma.user.findMany({
      where: { organizationId: u.organizationId, role: { in: STAFF } },
      include: { ssoIdentities: { select: { provider: true } }, passwordTokens: { where: { purpose: 'invite', usedAt: null }, select: { expiresAt: true }, orderBy: { createdAt: 'desc' }, take: 1 } },
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
    });
    return {
      emailConfigured: this.mail.status().configured,
      users: users.map((x) => ({
        id: x.id, name: x.name, email: x.email, role: x.role, active: x.active,
        status: !x.active ? 'deactivated' : x.passwordSetAt || x.ssoIdentities.length ? 'active' : 'invited',
        inviteExpiresAt: x.passwordTokens[0]?.expiresAt ?? null,
        lastLoginAt: x.lastLoginAt, mfaEnabled: !!x.mfaEnabledAt, sso: [...new Set(x.ssoIdentities.map((i) => i.provider))], createdAt: x.createdAt, isYou: x.id === u.id,
      })),
    };
  }

  /** Adds a staff member and emails an invitation to choose a password. The link is also returned, to share another way. */
  @Post()
  async invite(@CurrentUser() u: AuthUser, @Body(new ZodPipe(inviteSchema)) body: z.infer<typeof inviteSchema>) {
    if (await this.prisma.user.count({ where: { organizationId: u.organizationId, email: body.email } })) throw new BadRequestException('Someone with that email is already in your organization');
    // Nobody can sign in with this password: it is random and never shown.
    const created = await this.prisma.user.create({
      data: { organizationId: u.organizationId, email: body.email, name: body.name, role: body.role, passwordHash: await bcrypt.hash(randomToken(32), 10) },
      include: { organization: true },
    });
    const link = await this.passwords.issue(created, 'invite', u.id);
    const emailed = await this.passwords.email(created, 'invite', link, u.name);
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'user.invite', entityType: 'User', entityId: created.id, detail: { email: body.email, role: body.role, emailed } });
    return { id: created.id, emailed, inviteUrl: link.url, expiresAt: link.expiresAt };
  }

  private async member(u: AuthUser, id: string) {
    const x = await this.prisma.user.findFirst({ where: { id, organizationId: u.organizationId, role: { in: STAFF } }, include: { organization: true } });
    if (!x) throw new NotFoundException('Team member not found');
    return x;
  }

  @Patch(':id')
  async update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(updateSchema)) body: z.infer<typeof updateSchema>) {
    const x = await this.member(u, id);
    const losesAdmin = x.role === 'ADMIN' && x.active && ((body.role && body.role !== 'ADMIN') || body.active === false);
    if (x.id === u.id && losesAdmin) throw new ForbiddenException('You cannot remove your own admin access. Ask another admin.');
    const data: Prisma.UserUpdateInput = { ...body };
    if (body.active === false && x.active) data.sessionsValidAfter = new Date(); // signed out at once
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data });
      if (losesAdmin && (await tx.user.count({ where: { organizationId: u.organizationId, role: 'ADMIN', active: true } })) === 0) throw new BadRequestException('Keep at least one active admin');
      await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: body.active === false ? 'user.deactivate' : body.active === true ? 'user.reactivate' : 'user.update', entityType: 'User', entityId: id, detail: { ...body, previous: { role: x.role, active: x.active, name: x.name } } }, tx);
    });
    return { ok: true };
  }

  /** Sends a new invitation (someone did not set a password in time) or a password reset link. */
  @Post(':id/link')
  async link(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const x = await this.member(u, id);
    if (!x.active) throw new BadRequestException('Reactivate this person first');
    const purpose: Purpose = x.passwordSetAt ? 'reset' : 'invite';
    const link = await this.passwords.issue(x, purpose, u.id);
    const emailed = await this.passwords.email(x, purpose, link, u.name);
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: purpose === 'invite' ? 'user.reinvite' : 'password.reset_sent', entityType: 'User', entityId: id, detail: { emailed } });
    return { purpose, emailed, url: link.url, expiresAt: link.expiresAt };
  }

  /** Signs the person out of every browser and device (e.g. a lost laptop). */
  @Post(':id/sign-out')
  @HttpCode(200)
  async signOut(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    await this.member(u, id);
    await this.prisma.user.update({ where: { id }, data: { sessionsValidAfter: new Date() } });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'user.sign_out_everywhere', entityType: 'User', entityId: id });
    return { ok: true };
  }
}
