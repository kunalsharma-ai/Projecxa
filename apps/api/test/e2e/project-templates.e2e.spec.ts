import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '../../src/prisma/client';
import { api, createApp, login, makeOrg, resetDb } from './helpers';

const GATE = [{ id: 'gender', type: 'single', text: 'Gender?', options: [{ id: 'm', label: 'Male' }, { id: 'f', label: 'Female' }] }];
const DESIGN = {
  template: 'split',
  colors: { primary: '#7c3aed', accent: '#ec4899', background: '#f6f0ff', surface: '#ffffff', text: '#1b1029' },
  font: 'serif',
  radius: 'round',
  brandName: 'Acme Panel',
  footer: 'Thanks',
  confetti: true,
  texts: {},
  interstitial: { enabled: false, seconds: 3 },
};
const LINK = 'https://client.example.com/s?rid={session_token}';

describe('Project templates, drafts and settings history (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let admin: ReturnType<typeof api>;
  let pm: ReturnType<typeof api>;
  let viewer: ReturnType<typeof api>;
  let other: ReturnType<typeof api>;
  let otherPm: ReturnType<typeof api>;
  let clientId: string;
  let vendorA: string;
  let vendorB: string;
  let source: { id: string; countries: { id: string; countryCode: string }[] };

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await resetDb(prisma);
    const a = await makeOrg(prisma, 'tpl');
    const b = await makeOrg(prisma, 'tpl-other');
    admin = api(app, await login(app, a.users.ADMIN.email));
    pm = api(app, await login(app, a.users.PROJECT_MANAGER.email));
    viewer = api(app, await login(app, a.users.VIEWER.email));
    other = api(app, await login(app, b.users.ADMIN.email));
    await prisma.user.create({ data: { organizationId: a.org.id, email: 'pm2@tpl.test', name: 'Second PM', role: 'PROJECT_MANAGER', passwordHash: (await prisma.user.findUniqueOrThrow({ where: { id: a.users.PROJECT_MANAGER.id } })).passwordHash } });
    otherPm = api(app, await login(app, 'pm2@tpl.test'));
    clientId = (await pm.post('/clients', { name: 'Acme', code: 'ACME' }).expect(201)).body.id;
    vendorA = (await pm.post('/vendors', { name: 'Vendor A', code: 'VA' }).expect(201)).body.id;
    vendorB = (await pm.post('/vendors', { name: 'Vendor B', code: 'VB' }).expect(201)).body.id;
    source = (
      await pm
        .post('/projects', {
          name: 'Brand tracker wave 1',
          type: 'TRACKER',
          category: 'B2C',
          clientId,
          description: 'Monthly brand health',
          devices: { desktop: true, mobile: true, tablet: false },
          security: { gateSurvey: true, captcha: true, duplicateDetection: true },
          defaults: { language: 'en', loiMinutes: 12, irPercent: 40, cpi: 3, targetCompletes: 200, liveSurveyUrl: LINK },
          countries: [{ countryCode: 'US', currency: 'USD' }, { countryCode: 'GB', currency: 'GBP', cpi: 4, targetCompletes: 150 }],
        })
        .expect(201)
    ).body;
    const [gb, us] = source.countries;
    await pm.patch(`/projects/${source.id}`, { gateQuestions: GATE, captchaStyle: 'logic', autopilot: { pauseOnQuality: true, closeOnTarget: true } }).expect(200);
    await pm.put(`/projects/${source.id}/page-design`).send(DESIGN).expect(200);
    await pm.put(`/projects/${source.id}/countries/${us.id}/quotas`, { cells: [{ group: 'Gender', name: 'Female', target: 100, conditions: [{ source: 'gate', questionId: 'gender', values: ['f'] }] }] }).expect(200);
    await pm.post(`/projects/${source.id}/countries/${us.id}/allocations`, { vendorId: vendorA, cpi: 1.5, targetCompletes: 200 }).expect(201);
    await pm.post(`/projects/${source.id}/countries/${gb.id}/allocations`, { vendorId: vendorB, cpi: 2, targetCompletes: 150 }).expect(201);
    // A redirect rule for vendor B only, and one for the whole project.
    const v = await prisma.project.findUniqueOrThrow({ where: { id: source.id }, select: { activeRedirectVersionId: true } });
    const ver = await prisma.redirectPolicyVersion.findUniqueOrThrow({ where: { id: v.activeRedirectVersionId! } });
    const cfg = ver.config as { rules: unknown[]; params: unknown[] };
    await prisma.redirectPolicyVersion.update({
      where: { id: ver.id },
      data: { config: { ...cfg, rules: [{ status: 'COMPLETE', type: 'STATIC', url: 'https://acme.example.com/done', enabled: true, callbackRequired: false }, { status: 'TERMINATE', type: 'STATIC', url: 'https://vb.example.com/t', enabled: true, callbackRequired: false, scope: { vendorId: vendorB } }] } as never },
    });
  });
  afterAll(async () => {
    await app.close();
  });

  let templateId: string;

  it('saves a project as a template without its survey links or client unless asked', async () => {
    await viewer.post(`/projects/${source.id}/template`, { name: 'Tracker' }).expect(403);
    await other.post(`/projects/${source.id}/template`, { name: 'Tracker' }).expect(404);
    const t = (await pm.post(`/projects/${source.id}/template`, { name: 'Brand tracker', description: 'Monthly wave' }).expect(201)).body;
    templateId = t.id;
    expect(t).toMatchObject({ name: 'Brand tracker', type: 'TRACKER', category: 'B2C', clientId: null, countries: ['GB', 'US'], gateQuestions: 1, quotaCells: 1, vendorLinks: 2, redirectRules: 2, useCount: 0, createdBy: 'PROJECT_MANAGER' });
    await pm.post(`/projects/${source.id}/template`, { name: 'Brand tracker' }).expect(409);

    const full = (await viewer.get(`/project-templates/${templateId}`).expect(200)).body;
    // Shared values become shared settings; GB keeps what differs.
    expect(full.form.defaults).toEqual({ loiMinutes: 12, irPercent: 40 });
    expect(full.form.countries).toEqual([
      { countryCode: 'GB', language: 'en', currency: 'GBP', cpi: 4, targetCompletes: 150 },
      { countryCode: 'US', language: 'en', currency: 'USD', cpi: 3, targetCompletes: 200 },
    ]);
    expect(JSON.stringify(full)).not.toContain('client.example.com');
    expect(full.form).toMatchObject({ devices: { desktop: true, mobile: true, tablet: false }, security: expect.objectContaining({ gateSurvey: true, duplicateDetection: true }), redirectMode: 'HYBRID' });

    const withClient = (await pm.post(`/projects/${source.id}/template`, { name: 'Acme tracker', include: { client: true, surveyLinks: true, quotas: false, vendors: false } }).expect(201)).body;
    expect(withClient).toMatchObject({ clientId, quotaCells: 0, vendorLinks: 0 });
    expect((await pm.get(`/project-templates/${withClient.id}`).expect(200)).body.form.defaults.liveSurveyUrl).toBe(LINK);
    expect((await other.get('/project-templates').expect(200)).body).toEqual([]);
  });

  it('creates a project from a template with its questions, design, quotas, vendors and redirects', async () => {
    await pm.patch(`/vendors/${vendorB}`, { status: 'INACTIVE' }).expect(200);
    const created = (
      await otherPm
        .post('/projects', {
          name: 'Brand tracker wave 2',
          type: 'TRACKER',
          category: 'B2C',
          clientId,
          templateId,
          defaults: { language: 'en', loiMinutes: 12, irPercent: 40, liveSurveyUrl: LINK },
          countries: [{ countryCode: 'US', currency: 'USD', cpi: 3, targetCompletes: 200 }, { countryCode: 'GB', currency: 'GBP', cpi: 4, targetCompletes: 150 }, { countryCode: 'DE', currency: 'EUR', cpi: 5, targetCompletes: 50 }],
        })
        .expect(201)
    ).body;
    expect(created.templateSkipped).toEqual(['GB/en: vendor Vendor B is no longer active']);
    const p = await prisma.project.findUniqueOrThrow({ where: { id: created.id }, include: { activeRedirectVersion: true, countries: { include: { quotas: true, allocations: true } } } });
    expect(p).toMatchObject({ captchaStyle: 'logic', gateQuestions: GATE, autopilot: { pauseOnQuality: true, closeOnTarget: true }, pageDesign: expect.objectContaining({ template: 'split', brandName: 'Acme Panel' }) });
    const us = p.countries.find((c) => c.countryCode === 'US')!;
    expect(us.quotas.map((q) => [q.name, q.target, q.completes])).toEqual([['Female', 100, 0]]);
    expect(us.allocations.map((a) => [a.vendorId, Number(a.cpi), a.completes])).toEqual([[vendorA, 1.5, 0]]);
    expect(p.countries.find((c) => c.countryCode === 'GB')!.allocations).toEqual([]);
    expect(p.countries.find((c) => c.countryCode === 'DE')!.quotas).toEqual([]);
    const rules = (p.activeRedirectVersion!.config as { rules: { url: string }[] }).rules;
    expect(rules.map((r) => r.url)).toEqual(['https://acme.example.com/done']);
    // Entry codes are new, never copied.
    const old = await prisma.vendorAllocation.findFirstOrThrow({ where: { vendorId: vendorA, projectCountry: { projectId: source.id } } });
    expect(us.allocations[0].entryCode).not.toBe(old.entryCode);

    const t = (await pm.get('/project-templates').expect(200)).body.find((x: { id: string }) => x.id === templateId);
    expect(t.useCount).toBe(1);
    expect(t.lastUsedAt).toBeTruthy();
    const h = (await pm.get(`/projects/${created.id}/history`).expect(200)).body;
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ version: 1, reason: 'Created from template “Brand tracker”', actor: 'Second PM', changes: [] });
    await other.post('/projects', { name: 'X', category: 'B2C', clientId, templateId, defaults: { language: 'en', loiMinutes: 1, irPercent: 1, cpi: 1, targetCompletes: 1 }, countries: [{ countryCode: 'US' }] }).expect(400);
  });

  it('lets the maker or an admin rename and delete a template', async () => {
    await otherPm.patch(`/project-templates/${templateId}`, { name: 'Mine' }).expect(403);
    await otherPm.delete(`/project-templates/${templateId}`).expect(403);
    expect((await pm.patch(`/project-templates/${templateId}`, { name: 'Brand tracker (monthly)', description: null }).expect(200)).body).toMatchObject({ name: 'Brand tracker (monthly)', description: null });
    await pm.patch(`/project-templates/${templateId}`, { name: 'Acme tracker' }).expect(409);
    await admin.delete(`/project-templates/${templateId}`).expect(200);
    await pm.get(`/project-templates/${templateId}`).expect(404);
  });

  it('saves drafts of the create form for their owner only, and removes a draft once its project exists', async () => {
    const d = (await pm.post('/project-drafts', { title: 'Half done', data: { info: { name: 'Half done' }, rows: [{ countryCode: 'FR' }] } }).expect(201)).body;
    await viewer.post('/project-drafts', { data: {} }).expect(403);
    expect((await pm.put(`/project-drafts/${d.id}`, { data: { info: { name: 'Nearly done' } } }).expect(200)).body.title).toBe('Untitled project');
    expect((await pm.get(`/project-drafts/${d.id}`).expect(200)).body.data).toEqual({ info: { name: 'Nearly done' } });
    await otherPm.get(`/project-drafts/${d.id}`).expect(404);
    expect((await otherPm.get('/project-drafts').expect(200)).body).toEqual([]);
    await pm.post('/project-drafts', { data: { blob: 'x'.repeat(95_000) } }).expect(400);
    await otherPm.post('/projects', { name: 'Nearly done', category: 'B2C', clientId, draftId: d.id, defaults: { language: 'en', loiMinutes: 1, irPercent: 1, cpi: 1, targetCompletes: 1 }, countries: [{ countryCode: 'US' }] }).expect(400);
    await pm.post('/projects', { name: 'Nearly done', category: 'B2C', clientId, draftId: d.id, defaults: { language: 'en', loiMinutes: 1, irPercent: 1, cpi: 1, targetCompletes: 1 }, countries: [{ countryCode: 'US' }] }).expect(201);
    expect((await pm.get('/project-drafts').expect(200)).body).toEqual([]);
  });

  it('keeps a version for every settings change, with who changed what', async () => {
    const h = (await viewer.get(`/projects/${source.id}/history`).expect(200)).body;
    // Created, gate/captcha/autopilot, page design.
    expect(h.map((v: { version: number }) => v.version)).toEqual([3, 2, 1]);
    expect(h[2]).toMatchObject({ reason: 'Created', actor: 'PROJECT_MANAGER' });
    expect(h[1].changes.map((c: { label: string }) => c.label)).toEqual(['Human check style', 'Gate survey questions', 'Autopilot']);
    expect(h[1].changes[0]).toMatchObject({ before: 'math', after: 'logic' });
    expect(h[1].changes[1]).toMatchObject({ before: null, after: '1 question' });
    expect(h[0].changes).toEqual([expect.objectContaining({ field: 'pageDesign', before: null, after: 'Custom' })]);

    const us = source.countries.find((c) => c.countryCode === 'US')!;
    await pm.patch(`/projects/${source.id}`, { name: 'Brand tracker W1', security: { gateSurvey: true, captcha: false, duplicateDetection: true }, fieldEndAt: '2026-12-01' }).expect(200);
    await pm.patch(`/projects/${source.id}/countries/${us.id}`, { cpi: 3.5, loiMinutes: 14 }).expect(200);
    await pm.patch(`/projects/${source.id}`, { name: 'Brand tracker W1' }).expect(200); // no change, no version
    const h2 = (await pm.get(`/projects/${source.id}/history`).expect(200)).body;
    expect(h2.map((v: { version: number }) => v.version)).toEqual([5, 4, 3, 2, 1]);
    expect(h2[1].changes).toEqual([
      { field: 'name', label: 'Name', before: 'Brand tracker wave 1', after: 'Brand tracker W1' },
      { field: 'fieldEndAt', label: 'Field end', before: null, after: '2026-12-01' },
      { field: 'security.captcha', label: 'Security: captcha', before: 'On', after: 'Off' },
    ]);
    expect(h2[0].changes).toEqual([
      { field: 'countries.US/en.loiMinutes', label: 'US/en: LOI (min)', before: '12', after: '14' },
      { field: 'countries.US/en.cpi', label: 'US/en: CPI', before: '3', after: '3.5' },
    ]);
  });

  it('restores an earlier version, which becomes a new version, and leaves the status alone', async () => {
    await pm.patch(`/projects/${source.id}`, { status: 'TEST' }).expect(200);
    await viewer.post(`/projects/${source.id}/history/3/restore`, {}).expect(403);
    await other.post(`/projects/${source.id}/history/3/restore`, {}).expect(404);
    await pm.post(`/projects/${source.id}/history/99/restore`, {}).expect(404);
    const r = (await pm.post(`/projects/${source.id}/history/3/restore`, { reason: 'Client asked for the old setup' }).expect(201)).body;
    expect(r).toMatchObject({ name: 'Brand tracker wave 1', status: 'TEST', fieldEndAt: null, restoredVersion: 7 });
    expect(r.security.captcha).toBe(true);
    const us = r.countries.find((c: { countryCode: string }) => c.countryCode === 'US');
    expect([us.loiMinutes, Number(us.cpi)]).toEqual([12, 3]);
    const h = (await pm.get(`/projects/${source.id}/history`).expect(200)).body;
    expect(h[0]).toMatchObject({ version: 7, reason: 'Restored version 3: Client asked for the old setup' });
    expect(h[0].changes.map((c: { field: string }) => c.field)).toEqual(['name', 'fieldEndAt', 'security.captcha', 'countries.US/en.loiMinutes', 'countries.US/en.cpi']);
    expect(h[1].changes).toEqual([{ field: 'status', label: 'Status', before: 'DRAFT', after: 'TEST' }]);
    expect(await prisma.auditEvent.count({ where: { action: 'project.restore-settings', entityId: source.id } })).toBe(1);
  });

  it('gives projects made before history was kept a starting version on their first change', async () => {
    const p = (await pm.post('/projects', { name: 'Old one', category: 'B2C', clientId, defaults: { language: 'en', loiMinutes: 5, irPercent: 50, cpi: 1, targetCompletes: 10 }, countries: [{ countryCode: 'US' }] }).expect(201)).body;
    await prisma.projectSettingsVersion.deleteMany({ where: { projectId: p.id } });
    await pm.patch(`/projects/${p.id}`, { category: 'B2B' }).expect(200);
    const h = (await pm.get(`/projects/${p.id}/history`).expect(200)).body;
    expect(h.map((v: { version: number; reason: string | null }) => [v.version, v.reason])).toEqual([[2, null], [1, 'Settings before history was kept']]);
    expect(h[0].changes).toEqual([{ field: 'category', label: 'Category', before: 'B2C', after: 'B2B' }]);
  });
});
