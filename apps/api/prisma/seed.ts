/**
 * Development seed with synthetic data only (no real clients, vendors or respondents).
 * Usage: pnpm db:seed   (re-running wipes the demo organization first)
 */
import 'dotenv/config';
import { Prisma, PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { questionTemplates } from '../src/survey/questions';

const prisma = new PrismaClient();
const token = (n = 12) => randomBytes(n).toString('base64url');
const WEB = (process.env.WEB_ORIGIN ?? 'http://localhost:3000').split(',')[0].replace(/\/$/, '');
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'projexa-demo-2026';

async function main() {
  await prisma.project.deleteMany({ where: { organization: { slug: 'demo' } } });
  await prisma.organization.deleteMany({ where: { slug: 'demo' } });

  const org = await prisma.organization.create({
    data: {
      name: 'Demo Research Co.',
      slug: 'demo',
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
    data: { organizationId: org.id, email: 'admin@projexa.local', name: 'Administrator', passwordHash: hash, role: 'ADMIN' },
  });
  const pm = await prisma.user.create({
    data: { organizationId: org.id, email: 'pm@projexa.local', name: 'Priya Manager', passwordHash: hash, role: 'PROJECT_MANAGER' },
  });
  await prisma.user.create({
    data: { organizationId: org.id, email: 'sales@projexa.local', name: 'Sam Sales', passwordHash: hash, role: 'SALES' },
  });

  const acme = await prisma.client.create({
    data: {
      organizationId: org.id,
      name: 'Acme Insights',
      code: 'ACME',
      s2sSecret: token(32),
      contacts: { create: [{ name: 'Alex Client', email: 'alex@acme.example.com' }] },
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
    },
  });
  const beta = await prisma.vendor.create({
    data: { organizationId: org.id, name: 'Sample Beta', code: 'SBETA', callbackSecret: token(32), redirectAllowedDomains: ['sample-beta.example.com'] },
  });

  // Portal logins (milestone 2)
  await prisma.user.create({
    data: { organizationId: org.id, email: 'client@projexa.local', name: 'Alex Client', passwordHash: hash, role: 'CLIENT_USER', clientId: acme.id },
  });
  await prisma.user.create({
    data: { organizationId: org.id, email: 'vendor@projexa.local', name: 'Val Vendor', passwordHash: hash, role: 'VENDOR_USER', vendorId: alpha.id },
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
  await seedWonBids(org.id);

  console.log(`Seeded organization "demo".
  Sign in: admin@projexa.local or pm@projexa.local, password: ${ADMIN_PASSWORD}
  Portals: client@projexa.local (Acme Insights), vendor@projexa.local (Panel Alpha), same password
  Demo project: ${project.projectCode} (US, GB, DE × Panel Alpha, Sample Beta)
  Won bids: 3 synthetic Bidzo bids waiting for setup at /won-bids`);
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

function pick<T>(rnd: () => number, xs: T[]): T {
  return xs[Math.floor(rnd() * xs.length)];
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

/** Synthetic bids as if Bidzo had sent `bid.won`, so the Won bids list has something to set up. */
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
