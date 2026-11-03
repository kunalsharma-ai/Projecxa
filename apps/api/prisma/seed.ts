/**
 * Development seed with synthetic data only (no real clients, vendors or respondents).
 * Usage: pnpm db:seed   (re-running wipes the demo organization first)
 */
import 'dotenv/config';
import { Prisma, PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';

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
        gateSurvey: true, prescreening: false, urlProtection: true, geolocation: false, browserFingerprinting: false, captcha: true,
        duplicateDetection: false, browserLanguage: false, timezoneTracking: false, torDetection: false, cookieValidation: false,
      },
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

  console.log(`Seeded organization "demo".
  Sign in: admin@projexa.local or pm@projexa.local, password: ${ADMIN_PASSWORD}
  Demo project: ${project.projectCode} (US, GB, DE × Panel Alpha, Sample Beta)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
