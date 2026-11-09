/**
 * Development seed with synthetic data only (no real clients, vendors or respondents).
 * Usage: pnpm db:seed   (re-running wipes the demo organization first)
 */
import 'dotenv/config';
import { Prisma, PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { questionTemplates } from '../src/survey/questions';
import { matchCells, Respondent } from '../src/quotas/quota.rules';
import { PayablesService } from '../src/finance/payables.service';
import { AuditService } from '../src/audit/audit.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { WebhooksService } from '../src/webhooks/webhooks.service';
import { newApiKey } from '../src/public-api/api-keys';
import { nextRunAt } from '../src/schedules/schedule.rules';

const prisma = new PrismaClient();
const token = (n = 12) => randomBytes(n).toString('base64url');
const WEB = (process.env.WEB_ORIGIN ?? 'http://localhost:3000').split(',')[0].replace(/\/$/, '');
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'projexa-demo-2026';

async function main() {
  await prisma.project.deleteMany({ where: { organization: { slug: 'demo' } } });
  await prisma.organization.deleteMany({ where: { slug: { in: ['demo', 'northwind', 'bluebird', 'orbit'] } } });

  const org = await prisma.organization.create({
    data: {
      name: 'Demo Research Co.',
      slug: 'demo',
      // Runs this server: its admin below is the Super Admin (docs/SUPER_ADMIN.md).
      platformOwner: true,
      // Local demo pages live on the web app; production tenants list their real client/vendor domains.
      redirectAllowedDomains: ['localhost', '*.example.com'],
      fallbackRedirectUrl: null,
      defaultRedirectConfig: {
        rules: [{ status: 'TECHNICAL_ERROR', type: 'STATIC', url: `${WEB}/mock/end?state=technical_error`, enabled: true, callbackRequired: false }],
        params: [],
      },
    },
  });
  const hash = await bcrypt.hash(ADMIN_PASSWORD, 10);
  const admin = await prisma.user.create({
    data: { organizationId: org.id, email: 'admin@projexa.local', name: 'Administrator', passwordHash: hash, passwordSetAt: new Date(), role: 'ADMIN', superAdmin: true },
  });
  const pm = await prisma.user.create({
    data: { organizationId: org.id, email: 'pm@projexa.local', name: 'Priya Manager', passwordHash: hash, passwordSetAt: new Date(), role: 'PROJECT_MANAGER' },
  });
  await prisma.user.create({
    data: { organizationId: org.id, email: 'sales@projexa.local', name: 'Sam Sales', passwordHash: hash, passwordSetAt: new Date(), role: 'SALES' },
  });

  const acme = await prisma.client.create({
    data: {
      organizationId: org.id,
      name: 'Acme Insights',
      code: 'ACME',
      website: 'https://acme.example.com',
      s2sSecret: token(32),
      contacts: { create: [{ name: 'Alex Client', email: 'alex@acme.example.com', phone: '+1 212 555 0100' }] },
    },
    include: { contacts: true },
  });
  await prisma.client.create({ data: { organizationId: org.id, name: 'Northwind Research', code: 'NWR', s2sSecret: token(32) } });

  const alpha = await prisma.vendor.create({
    data: {
      organizationId: org.id,
      name: 'Panel Alpha',
      code: 'PALPHA',
      callbackSecret: token(32),
      redirectAllowedDomains: ['panel-alpha.example.com'],
      callbackUrlTemplate: `${WEB}/mock/callback?vendor=PALPHA&uid={uid}&status={status}`,
      contactName: 'Priya Ops', contactEmail: 'ops@panel-alpha.example.com', website: 'https://panel-alpha.example.com',
      // Every redirect the vendor gave us (local mock pages); projects use them through {vendor_redirect}.
      redirectUrls: {
        COMPLETE: `${WEB}/mock/vendor/PALPHA?state=complete&uid={respondent_uid}`,
        TERMINATE: `${WEB}/mock/vendor/PALPHA?state=terminate&uid={respondent_uid}`,
        QUOTA_FULL: `${WEB}/mock/vendor/PALPHA?state=quotafull&uid={respondent_uid}`,
        SECURITY_REJECT: `${WEB}/mock/vendor/PALPHA?state=security&uid={respondent_uid}`,
      },
    },
  });
  const beta = await prisma.vendor.create({
    data: {
      organizationId: org.id, name: 'Sample Beta', code: 'SBETA', callbackSecret: token(32), redirectAllowedDomains: ['sample-beta.example.com'],
      contactEmail: 'pm@sample-beta.example.com',
      redirectUrls: { COMPLETE: `${WEB}/mock/vendor/SBETA?state=complete&rid={respondent_uid}`, TERMINATE: `${WEB}/mock/vendor/SBETA?state=terminate&rid={respondent_uid}` },
    },
  });

  // Portal logins (milestone 2)
  await prisma.user.create({
    data: { organizationId: org.id, email: 'client@projexa.local', name: 'Alex Client', passwordHash: hash, passwordSetAt: new Date(), role: 'CLIENT_USER', clientId: acme.id },
  });
  await prisma.user.create({
    data: { organizationId: org.id, email: 'vendor@projexa.local', name: 'Val Vendor', passwordHash: hash, passwordSetAt: new Date(), role: 'VENDOR_USER', vendorId: alpha.id },
  });

  const vendorEnd = (code: string) => `${WEB}/mock/vendor/${code}`;
  const config = {
    rules: [
      // Project-level hybrid matrix
      { status: 'COMPLETE', type: 'DYNAMIC', url: `${vendorEnd('generic')}?state=complete`, enabled: true, callbackRequired: true },
      { status: 'TERMINATE', type: 'DYNAMIC', url: `${vendorEnd('generic')}?state=terminate`, enabled: true, callbackRequired: true },
      { status: 'QUOTA_FULL', type: 'STATIC', url: `${WEB}/mock/end?state=quota_full`, enabled: true, callbackRequired: false },
      { status: 'QUALITY_FAIL', type: 'DYNAMIC', url: `${vendorEnd('generic')}?state=quality_fail`, enabled: true, callbackRequired: true },
      { status: 'DUPLICATE', type: 'STATIC', url: `${WEB}/mock/end?state=duplicate`, enabled: true, callbackRequired: false },
      { status: 'SECURITY_REJECT', type: 'STATIC', url: `${WEB}/mock/end?state=security_reject`, enabled: true, callbackRequired: false },
      { status: 'PARTIAL', type: 'DYNAMIC', url: `${vendorEnd('generic')}?state=partial`, enabled: true, callbackRequired: false },
      // Vendor override: Panel Alpha wants completes on its own page
      { status: 'COMPLETE', type: 'DYNAMIC', url: `${vendorEnd('PALPHA')}?state=complete`, enabled: true, callbackRequired: true, scope: { vendorId: alpha.id } },
      // Country override: Germany terminates go to a static page
      { status: 'TERMINATE', type: 'STATIC', url: `${WEB}/mock/end?state=terminate&market=de`, enabled: true, callbackRequired: false, scope: { countryCode: 'DE' } },
      // Vendor + country override: Sample Beta in the UK
      {
        status: 'COMPLETE',
        type: 'DYNAMIC',
        url: `${vendorEnd('SBETA')}?state=complete&market=uk&rid={respondent_uid}`,
        enabled: true,
        callbackRequired: false,
        scope: { vendorId: beta.id, countryCode: 'GB' },
      },
    ],
    params: [
      { canonical: 'respondent_uid', alias: 'uid', required: true },
      { canonical: 'vendor_id', alias: 'vid', required: true },
      { canonical: 'country_code', alias: 'country', required: true },
      { canonical: 'respondent_uid', alias: 'respondent_id', required: true, scope: { vendorId: beta.id } },
    ],
  };

  const mockSurvey = `${WEB}/mock/survey?token={session_token}&country={country_code}`;
  const project = await prisma.project.create({
    data: {
      organizationId: org.id,
      projectCode: 'PRX10001',
      workOrderNo: 'WO9001',
      name: 'B2B IT decision makers – multi-country',
      category: 'B2B',
      status: 'LIVE',
      clientId: acme.id,
      clientContactId: acme.contacts[0].id,
      projectManagerId: pm.id,
      salesPersonId: admin.id,
      devices: { desktop: true, mobile: true, tablet: false },
      security: {
        gateSurvey: true, prescreening: true, urlProtection: false, geolocation: false, browserFingerprinting: true, captcha: false,
        duplicateDetection: true, browserLanguage: false, timezoneTracking: false, torDetection: false, cookieValidation: true,
      },
      captchaStyle: 'logic',
      fieldStartAt: new Date(Date.now() - 5 * 86_400_000),
      fieldEndAt: new Date(Date.now() + 4 * 86_400_000),
      autopilot: { pauseOnQuality: true, closeOnTarget: false },
      pageDesign: {
        template: 'aurora',
        colors: { primary: '#7c3aed', accent: '#ec4899', background: '#f6f0ff', surface: '#ffffff', text: '#1b1029' },
        font: 'geometric',
        radius: 'round',
        brandName: 'Sampledge Panel',
        footer: 'Questions? Write to support@example.com. Your answers stay confidential.',
        confetti: true,
        texts: { complete: { title: 'You did it, thank you!', message: 'Your answers are in. Your reward will reach your panel account within 48 hours.' } },
        interstitial: { enabled: false, seconds: 5 },
      },
      gateQuestions: GATE_QUESTIONS as unknown as Prisma.InputJsonValue,
      prescreen: PRESCREEN as unknown as Prisma.InputJsonValue,
      redirectMode: 'HYBRID',
      countries: {
        create: [
          { countryCode: 'US', language: 'en', targetGroup: 'IT decision makers', loiMinutes: 15, irPercent: 30, cpi: new Prisma.Decimal(12.5), currency: 'USD', targetCompletes: 50, status: 'LIVE', liveSurveyUrl: mockSurvey, testSurveyUrl: mockSurvey },
          { countryCode: 'GB', language: 'en', targetGroup: 'IT decision makers', loiMinutes: 15, irPercent: 25, cpi: new Prisma.Decimal(11), currency: 'GBP', targetCompletes: 40, status: 'LIVE', liveSurveyUrl: mockSurvey, testSurveyUrl: mockSurvey },
          { countryCode: 'DE', language: 'de', targetGroup: 'IT-Entscheider', loiMinutes: 15, irPercent: 20, cpi: new Prisma.Decimal(14), currency: 'EUR', targetCompletes: 30, status: 'LIVE', liveSurveyUrl: mockSurvey, testSurveyUrl: mockSurvey },
        ],
      },
    },
    include: { countries: true },
  });
  await prisma.organization.update({ where: { id: org.id }, data: { projectSeq: 10001, workOrderSeq: 9001 } });

  for (const c of project.countries) {
    for (const [v, cpi, target] of [[alpha, 4.5, 30], [beta, 4, 25]] as const) {
      await prisma.vendorAllocation.create({
        data: {
          projectCountryId: c.id,
          vendorId: v.id,
          cpi: new Prisma.Decimal(cpi),
          targetCompletes: Math.min(target, c.targetCompletes),
          entryCode: token(),
          testEntryCode: token(),
          uidParam: v.id === beta.id ? 'rid' : 'uid',
        },
      });
    }
  }
  const v1 = await prisma.redirectPolicyVersion.create({
    data: {
      projectId: project.id, version: 1, state: 'ACTIVE', mode: 'HYBRID', config: config as unknown as Prisma.InputJsonValue,
      changeReason: 'Seeded demo configuration', createdById: pm.id, approvedById: admin.id, activatedAt: new Date(),
    },
  });
  await prisma.project.update({ where: { id: project.id }, data: { activeRedirectVersionId: v1.id } });

  await seedHistory(project.id, org.id, v1.id);
  await seedFinance(project.id, org.id, pm.id);
  await seedQuotas(project.id);
  await seedPayables(org.id, pm.id);
  await seedWonBids(org.id);
  await seedIntegrations(org.id, admin.id);
  await seedSchedules(org.id, pm.id);
  await seedSuperAdmin(hash);

  console.log(`Seeded organization "demo".
  Sign in: admin@projexa.local or pm@projexa.local, password: ${ADMIN_PASSWORD}
  Portals: client@projexa.local (Acme Insights), vendor@projexa.local (Panel Alpha), same password
  Demo project: ${project.projectCode} (US, GB, DE × Panel Alpha, Sample Beta)
  Won bids: 3 synthetic SampBidx bids waiting for setup at /won-bids`);
}

/**
 * Three weeks of synthetic fieldwork traffic so reports and dashboards have something to show.
 * Deterministic (fixed pseudo-random sequence), stays under every quota, and keeps the
 * country and allocation complete counters in step with the sessions.
 */
/** Demo gate survey: the standard profile questions from the library. */
const GATE_QUESTIONS = questionTemplates('USD').map((t) => t.question).filter((q) => q.id !== 'postal');
const PRESCREEN = [
  {
    id: 'it_role', type: 'single', text: 'Are you involved in buying IT products or services for your organisation?', required: true, validation: {},
    options: [{ id: 'decide', label: 'Yes, I make the final decision', action: 'qualify' }, { id: 'influence', label: 'Yes, I influence the decision', action: 'qualify' }, { id: 'no', label: 'No', action: 'accept' }],
  },
  {
    id: 'company_size', type: 'dropdown', text: 'How many people work at your organisation?', required: true, validation: {},
    options: [{ id: 's1', label: '1 to 9', action: 'terminate' }, { id: 's2', label: '10 to 249', action: 'accept' }, { id: 's3', label: '250 to 999', action: 'accept' }, { id: 's4', label: '1,000 or more', action: 'accept' }],
  },
];

/** Synthetic gate answers; screened-out respondents get a non-qualifying prescreen answer. */
function demoAnswers(rnd: () => number, screenedOut: boolean) {
  const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
  const label = (qid: string, id: string) => {
    const q = [...GATE_QUESTIONS, ...PRESCREEN].find((x) => x.id === qid)!;
    return q.options!.find((o) => o.id === id)!.label;
  };
  const choice = (qid: string, ids: string[]) => {
    const id = pick(ids);
    return { value: id, label: label(qid, id) };
  };
  const age = 23 + Math.floor(rnd() * 40);
  const role = screenedOut ? 'no' : pick(['decide', 'influence', 'influence']);
  return {
    gate: {
      age: { value: age, label: String(age) },
      gender: choice('gender', ['male', 'male', 'female', 'female', 'nonbinary', 'na']),
      income: choice('income', ['b2', 'b3', 'b3', 'b4', 'b5', 'b5', 'b6', 'na']),
      employment: choice('employment', ['full_time', 'full_time', 'full_time', 'self_employed', 'part_time']),
      education: choice('education', ['secondary', 'some_college', 'bachelor', 'bachelor', 'master', 'master', 'doctorate']),
    },
    prescreen: { it_role: { value: role, label: label('it_role', role) }, company_size: choice('company_size', ['s2', 's3', 's4', 's4']) },
  };
}

/** Two scheduled report emails with a little synthetic send history (example.com addresses only). */
async function seedSchedules(organizationId: string, createdById: string) {
  const inputs = [
    { name: 'Weekly vendor performance', report: 'vendor', period: 'last_7_days', frequency: 'weekly', dayOfWeek: 1, dayOfMonth: null, hour: 9, recipients: ['ops@example.com', 'vendor-desk@example.com'], skipEmpty: false },
    { name: 'Daily fieldwork summary', report: 'overall', period: 'yesterday', frequency: 'daily', dayOfWeek: null, dayOfMonth: null, hour: 8, recipients: ['pm-team@example.com'], skipEmpty: true },
  ];
  for (const [i, x] of inputs.entries()) {
    const s = await prisma.reportSchedule.create({ data: { ...x, organizationId, createdById, timezone: 'Asia/Kolkata', nextRunAt: nextRunAt({ ...x, timezone: 'Asia/Kolkata' }, new Date()), lastRunAt: new Date(Date.now() - (i + 1) * 86_400_000) } });
    const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
    await prisma.reportRun.createMany({
      data: [
        { scheduleId: s.id, status: 'SENT', trigger: 'scheduled', from: day(i ? 2 : 8), to: day(2), rows: i ? 3 : 4, recipients: x.recipients, createdAt: new Date(Date.now() - (i + 1) * 86_400_000) },
        ...(i ? [{ scheduleId: s.id, status: 'SKIPPED', trigger: 'scheduled', from: day(3), to: day(3), rows: 0, recipients: x.recipients, createdAt: new Date(Date.now() - 2 * 86_400_000) }] : []),
      ],
    });
  }
}

/**
 * A demo API key and a switched-off webhook endpoint with some synthetic delivery history.
 * The endpoint is off so the demo never sends traffic to the example URL.
 */
async function seedIntegrations(organizationId: string, adminId: string) {
  const { prefix, keyHash } = newApiKey(); // the key itself is thrown away: create your own in Settings
  await prisma.apiKey.create({ data: { organizationId, name: 'Data warehouse sync (demo)', prefix, keyHash, scopes: ['projects:read', 'sessions:read', 'finance:read'], createdById: adminId, lastUsedAt: new Date(Date.now() - 2 * 3_600_000) } });
  const ep = await prisma.webhookEndpoint.create({
    data: { organizationId, url: 'https://hooks.example.com/projexa', description: 'Ops dashboard (demo, switched off)', secret: `whsec_${randomBytes(24).toString('base64url')}`, events: ['session.completed', 'project.status_changed', 'alert.opened'], active: false },
  });
  const rows: Prisma.WebhookDeliveryCreateManyInput[] = [];
  for (let i = 0; i < 6; i++) {
    const at = new Date(Date.now() - (i + 1) * 47 * 60_000);
    const failed = i === 2;
    rows.push({
      organizationId, endpointId: ep.id, event: i % 3 === 1 ? 'alert.opened' : 'session.completed', eventId: `evt_demo${i}`,
      payload: { id: `evt_demo${i}`, event: 'session.completed', createdAt: at.toISOString(), data: { note: 'Synthetic demo event' } },
      state: failed ? 'DEAD_LETTER' : 'DELIVERED', attempts: failed ? 8 : 1, lastStatusCode: failed ? 503 : 200, lastError: failed ? 'HTTP 503' : null,
      deliveredAt: failed ? null : at, createdAt: at, nextAttemptAt: at,
    });
  }
  await prisma.webhookDelivery.createMany({ data: rows });
}

/** Exchange rates and vendor bills: one paid, one approved, the rest left as drafts. */
async function seedPayables(organizationId: string, actorId: string) {
  const db = prisma as unknown as PrismaService;
  const payables = new PayablesService(db, new AuditService(db), new WebhooksService(db));
  const u = { id: actorId, organizationId, role: 'PROJECT_MANAGER' as const, email: 'pm@projexa.local', name: 'PM' };
  await payables.saveSettings(u, { baseCurrency: 'USD', rates: [{ currency: 'EUR', rate: 1.08 }, { currency: 'GBP', rate: 1.27 }] });
  const upTo = new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10);
  const { bills } = await payables.createBills(u, { upTo, notes: 'Synthetic demo bill' });
  for (const [i, b] of bills.entries()) {
    if (i > 1) break;
    await payables.update(u, b.id, { status: 'APPROVED', dueDays: 30, vendorReference: `VINV-${2201 + i}` });
    if (i === 0) await payables.update(u, b.id, { status: 'PAID', paymentReference: 'WIRE-77310' });
  }
}

/** Company-size and age quota cells for the US market, counted from the synthetic history. */
async function seedQuotas(projectId: string) {
  const us = await prisma.projectCountry.findFirstOrThrow({ where: { projectId, countryCode: 'US' } });
  const size = (id: string, name: string, target: number, sortOrder: number) => ({ projectCountryId: us.id, group: 'Company size', name, target, sortOrder, conditions: [{ source: 'prescreen', questionId: 'company_size', values: [id] }] });
  await prisma.quotaCell.createMany({
    data: [
      size('s2', '10 to 249', 15, 0),
      size('s3', '250 to 999', 15, 1),
      size('s4', '1,000 or more', 20, 2),
      { projectCountryId: us.id, group: 'Age', name: 'Under 35', target: 15, sortOrder: 3, conditions: [{ source: 'gate', questionId: 'age', max: 34 }] },
      { projectCountryId: us.id, group: 'Age', name: '35 and over', target: 35, sortOrder: 4, conditions: [{ source: 'gate', questionId: 'age', min: 35 }] },
    ],
  });
  const cells = await prisma.quotaCell.findMany({ where: { projectCountryId: us.id } });
  const sessions = await prisma.respondentSession.findMany({ where: { projectCountryId: us.id, isTest: false, status: { in: ['STARTED', 'COMPLETE'] } } });
  const counts = new Map<string, number>();
  for (const s of sessions) {
    const { matched } = matchCells(cells, { device: s.deviceType, answers: s.answers as Respondent['answers'] });
    await prisma.respondentSession.update({ where: { id: s.id }, data: { quotaCellIds: matched.map((c) => c.id) } });
    if (s.status === 'COMPLETE') for (const c of matched) counts.set(c.id, (counts.get(c.id) ?? 0) + 1);
  }
  for (const c of cells) await prisma.quotaCell.update({ where: { id: c.id }, data: { completes: counts.get(c.id) ?? 0 } });
}

async function seedHistory(projectId: string, organizationId: string, versionId: string) {
  let seed = 20261101;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const countries = await prisma.projectCountry.findMany({ where: { projectId }, include: { allocations: true } });
  const now = Date.now();
  const sessions: Prisma.RespondentSessionCreateManyInput[] = [];
  const events: Prisma.RespondentEventCreateManyInput[] = [];
  for (const c of countries) {
    const countryCap = Math.floor(c.targetCompletes * 0.6);
    let countryCompletes = 0;
    for (const a of c.allocations) {
      const cap = Math.floor(a.targetCompletes * 0.6);
      let completes = 0;
      for (let i = 1; i <= 60; i++) {
        const started = new Date(now - Math.floor(rnd() * 21 * 86_400_000) - 3_600_000);
        const r = rnd();
        let status: Prisma.RespondentSessionCreateManyInput['status'] =
          r < 0.32 ? 'COMPLETE' : r < 0.7 ? 'TERMINATE' : r < 0.8 ? 'QUOTA_FULL' : r < 0.86 ? 'QUALITY_FAIL' : r < 0.9 ? 'PARTIAL' : r < 0.93 ? 'SECURITY_REJECT' : 'STARTED';
        if (status === 'COMPLETE' && (completes >= cap || countryCompletes >= countryCap)) status = 'QUOTA_FULL';
        if (status === 'STARTED' && now - started.getTime() > 2 * 86_400_000) status = 'PARTIAL';
        const complete = status === 'COMPLETE';
        if (complete) { completes++; countryCompletes++; }
        const loiMs = (complete ? c.loiMinutes * (0.6 + rnd() * 0.9) : 2 + rnd() * 6) * 60_000;
        const outcomeAt = status === 'STARTED' ? null : new Date(started.getTime() + loiMs);
        const id = `seed-${c.countryCode}-${a.id.slice(-6)}-${i}`;
        const approval = !complete ? 'NOT_APPLICABLE' : started.getTime() < now - 10 * 86_400_000 ? (rnd() < 0.9 ? 'APPROVED' : 'REJECTED') : 'PENDING';
        // Some terminates happened on the prescreener, some security rejects at the gate.
        const prescreenOut = status === 'TERMINATE' && rnd() < 0.45;
        const gateReason = status === 'SECURITY_REJECT' ? pick(rnd, ['HUMAN_CHECK_FAILED', 'SAME_FINGERPRINT', 'COOKIES_BLOCKED']) : null;
        sessions.push({
          id, organizationId, projectId, projectCountryId: c.id, vendorAllocationId: a.id, token: token(16),
          vendorRespondentId: `DEMO-${a.uidParam === 'rid' ? 'B' : 'A'}-${c.countryCode}-${String(i).padStart(3, '0')}`,
          gateRequired: true,
          gatePassedAt: gateReason || prescreenOut ? null : new Date(started.getTime() + 45_000),
          humanAttempts: 1,
          humanPassedAt: gateReason === 'HUMAN_CHECK_FAILED' ? null : new Date(started.getTime() + 15_000),
          answers: gateReason ? undefined : (demoAnswers(rnd, prescreenOut) as unknown as Prisma.InputJsonValue),
          deviceType: pick(rnd, ['desktop', 'desktop', 'desktop', 'mobile']),
          status, statusDetail: status === 'PARTIAL' ? 'ABANDONED' : prescreenOut ? 'PRESCREEN' : gateReason, approval, outcomeVerified: complete && rnd() < 0.5,
          redirectVersionId: versionId, revenue: complete ? c.cpi : null, payout: complete ? a.cpi : null,
          startedAt: started, outcomeAt, expiresAt: new Date(started.getTime() + 2 * 86_400_000),
        });
        events.push({ sessionId: id, type: 'ENTRY', source: 'ENTRY', idempotencyKey: `entry:${id}`, createdAt: started });
        if (outcomeAt) events.push({ sessionId: id, type: 'OUTCOME', status, source: 'BROWSER', idempotencyKey: `outcome:${id}`, createdAt: outcomeAt });
      }
      await prisma.vendorAllocation.update({ where: { id: a.id }, data: { completes } });
    }
    await prisma.projectCountry.update({ where: { id: c.id }, data: { completes: countryCompletes } });
  }
  await prisma.respondentSession.createMany({ data: sessions });
  await prisma.respondentEvent.createMany({ data: events });
}

/**
 * Demo reconciliation and invoices: completes approved more than two weeks ago are billed,
 * one invoice per currency, shown as paid, sent and draft so every finance tile has data.
 */
async function seedFinance(projectId: string, organizationId: string, actorId: string) {
  const day = 86_400_000;
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { clientId: true, projectCode: true, name: true } });
  const approved = await prisma.respondentSession.findMany({
    where: { projectId, isTest: false, status: 'COMPLETE', approval: { in: ['APPROVED', 'REJECTED'] } },
    select: { id: true, approval: true, revenue: true, startedAt: true, projectCountry: { select: { countryCode: true, currency: true } } },
  });
  await prisma.respondentSession.updateMany({ where: { id: { in: approved.map((a) => a.id) } }, data: { approvalAt: new Date(Date.now() - 9 * day) } });
  await prisma.reconciliation.create({
    data: {
      organizationId, projectId, mode: 'final_list', submitted: approved.filter((a) => a.approval === 'APPROVED').length + 2,
      matched: approved.filter((a) => a.approval === 'APPROVED').length, approved: approved.filter((a) => a.approval === 'APPROVED').length,
      rejected: approved.filter((a) => a.approval === 'REJECTED').length, unchanged: 0, unknown: 2, locked: 0,
      unknownSample: ['RX-99812', 'RX-99815'], note: 'Client reconciliation file (synthetic demo)', actorId, createdAt: new Date(Date.now() - 9 * day),
    },
  });
  const billable = approved.filter((a) => a.approval === 'APPROVED' && a.startedAt.getTime() < Date.now() - 14 * day);
  const byCur = new Map<string, typeof billable>();
  for (const b of billable) byCur.set(b.projectCountry.currency, [...(byCur.get(b.projectCountry.currency) ?? []), b]);
  const states = [
    { status: 'PAID' as const, issued: 8, paid: 2 },
    { status: 'SENT' as const, issued: 5 },
    { status: 'DRAFT' as const },
  ];
  let seq = 0;
  for (const [i, [currency, list]] of [...byCur].sort(([a], [b]) => a.localeCompare(b)).entries()) {
    const st = states[i % states.length];
    const lines = new Map<string, { countryCode: string; description: string; quantity: number; unitPrice: number; amount: number }>();
    for (const s of list) {
      const price = Number(s.revenue ?? 0);
      const key = `${s.projectCountry.countryCode}:${price}`;
      const l = lines.get(key) ?? { countryCode: s.projectCountry.countryCode, description: `${project.projectCode} ${project.name}: completes, ${s.projectCountry.countryCode}`, quantity: 0, unitPrice: price, amount: 0 };
      l.quantity++;
      l.amount = Math.round(l.quantity * l.unitPrice * 100) / 100;
      lines.set(key, l);
    }
    const total = [...lines.values()].reduce((a, l) => a + l.amount, 0);
    const issuedAt = 'issued' in st ? new Date(Date.now() - (st.issued as number) * day) : null;
    const inv = await prisma.invoice.create({
      data: {
        organizationId, projectId, clientId: project.clientId, number: `INV-${new Date().getUTCFullYear()}-${String(++seq).padStart(5, '0')}`,
        status: st.status, currency, lines: [...lines.values()], completes: list.length, subtotal: new Prisma.Decimal(total.toFixed(2)), total: new Prisma.Decimal(total.toFixed(2)),
        notes: 'PO 4471 (synthetic demo)', issuedAt, dueAt: issuedAt ? new Date(issuedAt.getTime() + 30 * day) : null,
        paidAt: 'paid' in st ? new Date(Date.now() - (st.paid as number) * day) : null, createdById: actorId,
      },
    });
    await prisma.respondentSession.updateMany({ where: { id: { in: list.map((s) => s.id) } }, data: { invoiceId: inv.id } });
  }
  await prisma.organization.update({ where: { id: organizationId }, data: { invoiceSeq: seq } });
}

function pick<T>(rnd: () => number, xs: T[]): T {
  return xs[Math.floor(rnd() * xs.length)];
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

/** Synthetic bids as if SampBidx had sent `bid.won`, so the Won bids list has something to set up. */
async function seedWonBids(organizationId: string) {
  const day = 86_400_000;
  const bids = [
    { n: 'BID-2026-0412', name: 'Retail shopper journey tracker', client: 'Acme Insights', type: 'Tracker', cat: 'B2C', cur: 'USD', total: 18_450, ago: 1,
      countries: [{ countryCode: 'US', sampleSize: 800, loiMinutes: 15, incidencePct: 45, cpi: 3.75 }, { countryCode: 'CA', sampleSize: 300, loiMinutes: 15, incidencePct: 40, cpi: 4.1 }] },
    { n: 'BID-2026-0419', name: 'IT decision maker cloud study', client: 'Northwind Research', type: 'Ad hoc', cat: 'B2B', cur: 'EUR', total: 22_100, ago: 2,
      countries: [{ countryCode: 'DE', sampleSize: 150, loiMinutes: 20, incidencePct: 8, cpi: 48 }, { countryCode: 'FR', sampleSize: 120, loiMinutes: 20, incidencePct: 7.5, cpi: 52 }] },
    { n: 'BID-2026-0423', name: 'Pet food concept test', client: 'Harbor Analytics', type: 'Concept test', cat: 'B2C', cur: 'GBP', total: 6_900, ago: 0,
      countries: [{ countryCode: 'GB', sampleSize: 600, loiMinutes: 12, incidencePct: 35, cpi: 2.9, language: 'en' }] },
  ];
  for (const b of bids) {
    const wonAt = new Date(Date.now() - b.ago * day);
    const payload = { event: 'bid.won', eventId: `seed-${b.n}`, occurredAt: wonAt.toISOString(), bid: { id: `seed-${b.n}`, bidNumber: b.n, projectName: b.name, currency: b.cur, totalAmount: b.total, client: { name: b.client }, countries: b.countries } };
    await prisma.wonBid.create({
      data: {
        organizationId, externalId: `seed-${b.n}`, bidNumber: b.n, bidVersion: 1, projectName: b.name,
        description: `${b.name} (synthetic demo bid).`, projectType: b.type, projectCategory: b.cat,
        clientName: b.client, contactName: 'Jordan Buyer', contactEmail: 'jordan@example.com', bidderName: 'Sam Sales',
        currency: b.cur, totalAmount: b.total, countries: b.countries, wonAt, lastEventId: `seed-${b.n}`, payload,
      },
    });
  }
}

/** Super Admin demo: two customer organisations on plans and one registration waiting for approval. */
async function seedSuperAdmin(hash: string) {
  const { STARTER_PLANS } = await import('../src/super-admin/super-admin.service');
  for (const p of STARTER_PLANS) await prisma.plan.upsert({ where: { code: p.code }, create: p, update: {} });
  const plan = async (code: string) => (await prisma.plan.findUniqueOrThrow({ where: { code } })).id;
  const day = 86_400_000;
  const tenants = [
    { name: 'Northwind Panels', slug: 'northwind', plan: 'starter', status: 'ACTIVE' as const, endsAt: new Date(Date.now() + 5 * day), trialEndsAt: null, people: ['Nadia Admin', 'Omar PM', 'Lena Sales'] },
    { name: 'Bluebird Insights', slug: 'bluebird', plan: 'professional', status: 'TRIAL' as const, endsAt: null, trialEndsAt: new Date(Date.now() + 2 * day), people: ['Ben Admin', 'Chloe PM'] },
  ];
  for (const t of tenants) {
    const o = await prisma.organization.create({ data: { name: t.name, slug: t.slug } });
    await prisma.subscription.create({ data: { organizationId: o.id, planId: await plan(t.plan), status: t.status, endsAt: t.endsAt, trialEndsAt: t.trialEndsAt } });
    for (const [i, name] of t.people.entries()) {
      await prisma.user.create({
        data: { organizationId: o.id, email: `${name.split(' ')[0].toLowerCase()}@${t.slug}.example.com`, name, passwordHash: hash, passwordSetAt: new Date(), role: i === 0 ? 'ADMIN' : i === 1 ? 'PROJECT_MANAGER' : 'SALES', lastSeenAt: new Date(Date.now() - (i + 1) * 3_600_000), lastLoginAt: new Date(Date.now() - (i + 1) * 3_600_000) },
      });
    }
  }
  await prisma.featureOverride.create({ data: { organizationId: (await prisma.organization.findUniqueOrThrow({ where: { slug: 'northwind' } })).id, feature: 'monitor', channel: 'web', enabled: true } });
  // Feature access (docs/FEATURE_ACCESS.md): Northwind's Admin keeps the monitor extra to admins and gives tasks to Omar only.
  const omar = await prisma.user.findFirstOrThrow({ where: { email: 'omar@northwind.example.com' } });
  await prisma.organization.update({ where: { slug: 'northwind' }, data: { featureAccess: { monitor: { mode: 'admins', people: [] }, tasks: { mode: 'people', people: [omar.id] } } } });
  const orbit = await prisma.organization.create({
    data: { name: 'Orbit Analytics', slug: 'orbit', status: 'PENDING', registration: { contactName: 'Ivy Chen', phone: '+44 20 7946 0000', website: 'https://orbit.example.com', message: 'We run 40 B2B projects a month.', requestedPlan: 'professional', at: new Date().toISOString() } },
  });
  await prisma.user.create({ data: { organizationId: orbit.id, email: 'ivy@orbit.example.com', name: 'Ivy Chen', passwordHash: hash, role: 'ADMIN', active: false } });

  // Subscription payments (docs/SUBSCRIPTION_PAYMENTS.md): prices, billing settings, a paid and a waiting invoice.
  const prices: Record<string, [number, number]> = { starter: [4999, 49990], professional: [12999, 129990], enterprise: [29999, 299990] };
  for (const [code, [m, y]] of Object.entries(prices)) await prisma.plan.update({ where: { code }, data: { priceMonthly: m, priceYearly: y, currency: 'INR' } });
  const owner = await prisma.organization.findFirstOrThrow({ where: { platformOwner: true } });
  await prisma.organization.update({ where: { id: owner.id }, data: { platformSettings: { ...((owner.platformSettings ?? {}) as object), billing: {
    onlineEnabled: true, offlineEnabled: true, offlineMethods: ['bank_transfer', 'upi', 'cheque'], taxName: 'GST', taxPercent: 18,
    bankDetails: 'Account name: Sampledge Pvt Ltd\nAccount: 50200012345678\nIFSC: HDFC0001234 (HDFC Bank, Andheri East)', upiId: 'sampledge@hdfcbank',
    offlineInstructions: 'Write your organisation name in the payment remarks.', sellerName: 'Sampledge Pvt Ltd', sellerAddress: 'Andheri East, Mumbai 400069, India',
    sellerTaxId: '27AABCS1234F1Z5', sellerEmail: 'billing@sampledge.com', invoiceFooter: 'Thank you for choosing SampTrek.',
  } } } });
  const nw = await prisma.organization.findUniqueOrThrow({ where: { slug: 'northwind' } });
  const starter = await prisma.plan.findUniqueOrThrow({ where: { code: 'starter' } });
  const inv = (n: number, data: object) => prisma.billingInvoice.create({ data: { number: `SUB-${new Date().getUTCFullYear()}-${String(n).padStart(5, '0')}`, organizationId: nw.id, planId: starter.id, interval: 'MONTHLY', currency: 'INR', amount: 4999, taxName: 'GST', taxPercent: 18, taxAmount: 899.82, total: 5898.82, ...data } });
  await inv(1, { status: 'PAID', method: 'razorpay', reference: 'pay_PxD4mK2ZtYv9Lq', providerOrderId: 'order_demo_1', paidAt: new Date(Date.now() - 25 * day), paidOn: new Date(Date.now() - 25 * day), periodStart: new Date(Date.now() - 25 * day), periodEnd: new Date(Date.now() + 5 * day) });
  await inv(2, { status: 'PENDING_REVIEW', method: 'upi', reference: '431298765432', paidOn: new Date(Date.now() - day), note: 'Paid from our HDFC current account.' });
  await prisma.$executeRawUnsafe(`SELECT setval('billing_invoice_seq', 2)`);
}
