import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { api, createApp, login, makeOrg, resetDb } from './helpers';

describe('Clients, vendors and redirects editing (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let pm: ReturnType<typeof api>;
  let other: ReturnType<typeof api>;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await resetDb(prisma);
    const a = await makeOrg(prisma, 'edit-a', []);
    const b = await makeOrg(prisma, 'edit-b', []);
    pm = api(app, await login(app, a.users.PROJECT_MANAGER.email));
    other = api(app, await login(app, b.users.PROJECT_MANAGER.email));
  });
  afterAll(async () => {
    await app.close();
  });

  it('checks client websites and contact details, and edits everything later', async () => {
    const bad = await pm.post('/clients', { name: 'Acme', code: 'ACME', website: 'not a site', contacts: [{ name: 'Pat', email: 'nope', phone: '12' }] }).expect(400);
    const msg = JSON.stringify(bad.body);
    expect(msg).toMatch(/website/i);
    expect(msg).toMatch(/email address/i);
    expect(msg).toMatch(/phone number/i);
    await pm.post('/clients', { name: 'Acme', code: 'ACME', contacts: [{ name: 'Pat' }] }).expect(400);

    const c = (await pm.post('/clients', { name: 'Acme', code: 'acme', website: 'acme.example.com/', contacts: [{ name: 'Pat', email: 'PAT@acme.example.com', phone: '+44 20 7946 0000' }] }).expect(201)).body;
    expect(c.code).toBe('ACME');
    const got = (await pm.get(`/clients/${c.id}`).expect(200)).body;
    expect(got.website).toBe('https://acme.example.com');
    expect(got.contacts[0].email).toBe('pat@acme.example.com');
    await pm.post('/clients', { name: 'Acme 2', code: 'ACME' }).expect(409);

    // Edit: rename, new code, swap a contact, add one. The removed contact is unlinked from projects.
    const pat = got.contacts[0];
    const edited = (
      await pm
        .patch(`/clients/${c.id}`, { name: 'Acme Insights', code: 'ACMEI', website: 'https://www.acme.example.com', status: 'INACTIVE', contacts: [{ id: pat.id, name: 'Pat Lee', email: 'pat@acme.example.com' }, { name: 'Sam', phone: '+1 415 555 0100' }] })
        .expect(200)
    ).body;
    expect(edited).toMatchObject({ name: 'Acme Insights', code: 'ACMEI', status: 'INACTIVE', website: 'https://www.acme.example.com' });
    expect(edited.contacts.map((x: { name: string }) => x.name).sort()).toEqual(['Pat Lee', 'Sam']);
    const again = (await pm.patch(`/clients/${c.id}`, { contacts: [{ name: 'Only one', email: 'one@acme.example.com' }], website: '' }).expect(200)).body;
    expect(again.contacts).toHaveLength(1);
    expect(again.website).toBeNull();
    await other.patch(`/clients/${c.id}`, { name: 'x' }).expect(404);
  });

  it('bulk imports clients from the template, row by row, with a dry run first', async () => {
    const rows = [
      { name: 'Bright Data Co', website: 'bright.example.com', contact_name: 'Ana', contact_email: 'ana@bright.example.com', contact_phone: '+1 212 555 0101' },
      { name: 'Broken Row', contact_name: 'Bo', contact_email: 'not-an-email' },
      { name: 'Coded', code: 'acmei', contact_name: 'Cy', contact_email: 'cy@coded.example.com' },
    ];
    const dry = (await pm.post('/clients/import', { rows, dryRun: true }).expect(201)).body;
    expect(dry).toMatchObject({ dryRun: true, added: 0, valid: 1, failed: 2 });
    expect(dry.results[1].errors.join(' ')).toMatch(/contact_email/);
    expect(dry.results[2].errors.join(' ')).toMatch(/ACMEI is already used/);
    expect(await prisma.client.count({ where: { name: 'Bright Data Co' } })).toBe(0);

    const real = (await pm.post('/clients/import', { rows }).expect(201)).body;
    expect(real.added).toBe(1);
    expect(real.results[0].code).toBe('BRIDATCO');
    const made = await prisma.client.findFirstOrThrow({ where: { name: 'Bright Data Co' }, include: { contacts: true } });
    expect(made.website).toBe('https://bright.example.com');
    expect(made.contacts[0]).toMatchObject({ name: 'Ana', email: 'ana@bright.example.com' });
    // Importing the same name again is refused.
    expect((await pm.post('/clients/import', { rows: [rows[0]] }).expect(201)).body.failed).toBe(1);
  });

  it('saves every vendor redirect, allows their hosts, edits and bulk imports vendors', async () => {
    await pm.post('/vendors', { name: 'Bad', code: 'BAD', redirectUrls: { COMPLETE: 'ftp://x.example.com', TERMINATE: 'https://p.example.com/t?u={nope}' } }).expect(400);
    const v = (
      await pm
        .post('/vendors', {
          name: 'Panel Prime', code: 'PP', contactEmail: 'ops@prime.example.com', website: 'prime.example.com',
          callbackUrlTemplate: 'https://cb.prime.example.com/?uid={uid}&s={status}',
          redirectUrls: { COMPLETE: 'https://r.prime.example.com/end?st=1&uid={respondent_uid}', TERMINATE: 'https://r.prime.example.com/end?st=2&uid={respondent_uid}', QUOTA_FULL: 'https://r.prime.example.com/end?st=3', SECURITY_REJECT: 'https://r.prime.example.com/end?st=4' },
        })
        .expect(201)
    ).body;
    expect(v.redirectAllowedDomains).toEqual(['r.prime.example.com']);
    expect(v.website).toBe('https://prime.example.com');

    const ed = (await pm.patch(`/vendors/${v.id}`, { name: 'Panel Prime Ltd', contactPhone: '+91 22 5555 0101', redirectUrls: { COMPLETE: 'https://done.prime.example.com/c?uid={respondent_uid}', TERMINATE: '' } }).expect(200)).body;
    expect(ed.name).toBe('Panel Prime Ltd');
    expect(ed.redirectUrls).toEqual({ COMPLETE: 'https://done.prime.example.com/c?uid={respondent_uid}' });
    expect(ed.redirectAllowedDomains).toEqual(['r.prime.example.com', 'done.prime.example.com']);
    await pm.patch(`/vendors/${v.id}`, { callbackUrlTemplate: null }).expect(200);
    expect((await pm.get(`/vendors/${v.id}`).expect(200)).body.callbackUrlTemplate).toBeNull();

    const imp = (
      await pm
        .post('/vendors/import', {
          rows: [
            { name: 'Nordic Panels', contact_email: 'hi@nordic.example.com', complete_url: 'https://n.example.com/c?id={respondent_uid}', security_url: 'https://n.example.com/s', redirect_domains: 'extra.example.com' },
            { name: 'Bad Domains', redirect_domains: 'not a domain' },
          ],
        })
        .expect(201)
    ).body;
    expect(imp).toMatchObject({ added: 1, failed: 1 });
    const n = await prisma.vendor.findFirstOrThrow({ where: { name: 'Nordic Panels' } });
    expect(n.redirectUrls).toEqual({ COMPLETE: 'https://n.example.com/c?id={respondent_uid}', SECURITY_REJECT: 'https://n.example.com/s' });
    expect(n.redirectAllowedDomains.sort()).toEqual(['extra.example.com', 'n.example.com']);
  });

  it('new projects start with prebuilt redirects that send respondents to each vendor’s saved URLs', async () => {
    const client = (await pm.post('/clients', { name: 'Route client', code: 'RC', contacts: [{ name: 'R', email: 'r@route.example.com' }] }).expect(201)).body.id;
    const withUrls = (await pm.post('/vendors', { name: 'Has Links', code: 'HL', redirectUrls: { COMPLETE: 'https://hl.example.com/c?uid={respondent_uid}', TERMINATE: 'https://hl.example.com/t', SECURITY_REJECT: 'https://hl.example.com/s' } }).expect(201)).body.id;
    const without = (await pm.post('/vendors', { name: 'No Links', code: 'NL' }).expect(201)).body.id;
    const p = (
      await pm
        .post('/projects', {
          name: 'Acme secret brand test', category: 'B2C', clientId: client, redirectMode: 'HYBRID',
          defaults: { language: 'en', loiMinutes: 10, irPercent: 50, cpi: 5, targetCompletes: 10, liveSurveyUrl: 'https://survey.example.com/s?rid={session_token}' },
          countries: [{ countryCode: 'US' }],
        })
        .expect(201)
    ).body;
    const countryId = p.countries[0].id;
    for (const v of [withUrls, without]) await pm.post(`/projects/${p.id}/countries/${countryId}/allocations`, { vendorId: v, cpi: 2, targetCompletes: 5 }).expect(201);

    const policy = (await pm.get(`/projects/${p.id}/redirects`).expect(200)).body;
    expect(policy.active.config.rules).toHaveLength(8);
    expect(policy.active.config.rules.every((r: { url: string }) => r.url === '{vendor_redirect}')).toBe(true);
    expect(policy.active.config.rules.find((r: { status: string }) => r.status === 'COMPLETE').type).toBe('DYNAMIC');
    expect(policy.active.config.rules.find((r: { status: string }) => r.status === 'DUPLICATE').type).toBe('STATIC');
    expect(policy.outcomeLinks[0]).toEqual({ status: 'COMPLETE', url: expect.stringMatching(/\/r\/complete\?token=\[TOKEN\]$/) });
    // Vendors with no saved links get a warning, never an error.
    expect(policy.active.issues.some((i: { level: string; message: string }) => i.level === 'warning' && /No Links has no saved redirect/.test(i.message))).toBe(true);
    expect(policy.active.issues.filter((i: { level: string }) => i.level === 'error')).toEqual([]);

    const eff = (await pm.get(`/projects/${p.id}/redirects/effective`).expect(200)).body.rows as { vendor: { id: string }; status: string; destination: string; usedFallback: boolean; blockedReason: string | null }[];
    const at = (v: string, s: string) => eff.find((r) => r.vendor.id === v && r.status === s)!;
    expect(at(withUrls, 'COMPLETE').destination).toMatch(/^https:\/\/hl\.example\.com\/c\?uid=SAMPLE-UID/);
    expect(at(withUrls, 'COMPLETE').destination).toContain('vid=HL');
    // Duplicate falls back to the vendor's security redirect, unchanged (static).
    expect(at(withUrls, 'DUPLICATE').destination).toBe('https://hl.example.com/s');
    // Partial falls back to terminate; quota full has nothing saved, so the SampTrek end page is used.
    expect(at(withUrls, 'PARTIAL').destination).toBe('https://hl.example.com/t');
    expect(at(withUrls, 'QUOTA_FULL').usedFallback).toBe(true);
    expect(at(without, 'COMPLETE').blockedReason).toMatch(/No Links has no saved complete redirect/);

    // A live respondent from the vendor with saved links lands on its complete URL with the UID.
    await pm.patch(`/projects/${p.id}/countries/${countryId}`, { status: 'LIVE' }).expect(200);
    await pm.patch(`/projects/${p.id}`, { status: 'LIVE' }).expect(200);
    const alloc = (await pm.get(`/projects/${p.id}`).expect(200)).body.countries[0].allocations.find((a: { vendorId: string }) => a.vendorId === withUrls);
    const entry = await http().get(`/s/${alloc.entryCode}?uid=R-77`).expect(302);
    const done = await http().get(`/r/complete?token=${new URL(entry.headers.location).searchParams.get('rid')}`).expect(302);
    const dest = new URL(done.headers.location);
    expect(dest.host).toBe('hl.example.com');
    expect(dest.searchParams.get('uid')).toBe('R-77');

    // {vendor_redirect} must be the whole URL.
    const bad = (await pm.post(`/projects/${p.id}/redirects/versions`, { mode: 'DYNAMIC', config: { rules: [{ status: 'COMPLETE', type: 'DYNAMIC', url: 'https://x.example.com/{vendor_redirect}' }], params: [] } }).expect(201)).body;
    expect(bad.issues.some((i: { message: string }) => /must be the whole URL/.test(i.message))).toBe(true);
  });

  it('keeps client templates working: statuses the template sets are not prebuilt', async () => {
    const client = (await pm.post('/clients', { name: 'Templated', code: 'TPL', redirectTemplate: { rules: [{ status: 'COMPLETE', type: 'STATIC', url: 'https://tpl.example.com/c' }], params: [] } }).expect(201)).body.id;
    const p = (await pm.post('/projects', { name: 'T', category: 'B2C', clientId: client, defaults: { language: 'en', loiMinutes: 10, irPercent: 50, cpi: 5, targetCompletes: 10 }, countries: [{ countryCode: 'GB' }] }).expect(201)).body;
    const rules = (await pm.get(`/projects/${p.id}/redirects`).expect(200)).body.active.config.rules as { status: string }[];
    expect(rules).toHaveLength(7);
    expect(rules.some((r) => r.status === 'COMPLETE')).toBe(false);
  });

  it('vendors see a vendor-facing title, never the internal project name', async () => {
    const client = (await pm.post('/clients', { name: 'Secret Client', code: 'SEC', contacts: [{ name: 'S', email: 's@secret.example.com' }] }).expect(201)).body.id;
    const vendor = (await pm.post('/vendors', { name: 'Portal Vendor', code: 'PV' }).expect(201)).body.id;
    await pm.post('/portal-users', { kind: 'vendor', partyId: vendor, name: 'V user', email: 'v@pv.test', password: 'portal-pass-12345' }).expect(201);
    const vtok = (await http().post('/api/v1/auth/login').send({ email: 'v@pv.test', password: 'portal-pass-12345' }).expect(200)).body.token;
    const vapi = api(app, vtok);
    const p = (
      await pm
        .post('/projects', { name: 'Secret Client – Brand X concept test', category: 'B2C', clientId: client, defaults: { language: 'en', loiMinutes: 10, irPercent: 50, cpi: 5, targetCompletes: 10, liveSurveyUrl: 'https://survey.example.com/s' }, countries: [{ countryCode: 'US' }] })
        .expect(201)
    ).body;
    await pm.post(`/projects/${p.id}/countries/${p.countries[0].id}/allocations`, { vendorId: vendor, cpi: 2, targetCompletes: 5 }).expect(201);
    await pm.patch(`/projects/${p.id}/countries/${p.countries[0].id}`, { status: 'LIVE' }).expect(200);
    await pm.patch(`/projects/${p.id}`, { status: 'LIVE' }).expect(200);

    let rows = (await vapi.get('/portal/vendor/allocations').expect(200)).body;
    expect(rows[0].project.name).toBe(`Survey ${p.projectCode}`);
    expect(JSON.stringify(rows)).not.toContain('Brand X');
    expect(rows[0].project.vendorTitle).toBeUndefined();

    await pm.patch(`/projects/${p.id}`, { vendorTitle: 'Consumer survey, 10 min' }).expect(200);
    rows = (await vapi.get('/portal/vendor/allocations').expect(200)).body;
    expect(rows[0].project.name).toBe('Consumer survey, 10 min');
    // Staff still see the real name.
    expect((await pm.get(`/projects/${p.id}`).expect(200)).body.name).toContain('Brand X');
  });
});
