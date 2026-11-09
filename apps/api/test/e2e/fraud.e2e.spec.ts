import { createHash } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '../../src/prisma/client';
import request from 'supertest';
import { config } from '../../src/common/config';
import { IntegrationsService } from '../../src/integrations/integrations.service';
import { IpReputationService } from '../../src/survey/ip-reputation';
import { leadingZeroBits, powChallenge, POW_BITS } from '../../src/survey/respondent-checks';
import { api, createApp, login, makeOrg, resetDb } from './helpers';

const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36';
const CLEAN = { webdriver: false, automation: false, plugins: 5, languages: 2, touch: 0, platform: 'Win32', chrome: true, outer: 1280, renderer: 'ANGLE (Intel)' };

function solve(token: string) {
  const challenge = powChallenge(config.jwtSecret, token);
  for (let n = 0; ; n++) if (leadingZeroBits(createHash('sha256').update(`${challenge}:${n}`).digest()) >= POW_BITS) return n;
}

describe('Stronger fraud checks (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let pm: ReturnType<typeof api>;
  let admin: ReturnType<typeof api>;
  let other: ReturnType<typeof api>;
  let rep: IpReputationService;
  let n = 0;
  let orgId: string;
  const http = () => request(app.getHttpServer());
  const uid = () => `F${++n}`;
  /** Project → its vendor allocations (entry codes). */
  const projects: Record<string, { id: string; allocs: { entryCode: string; vendorCode: string }[] }> = {};

  async function makeProject(key: string, clientId: string, vendorIds: string[]) {
    const p = (
      await pm
        .post('/projects', {
          name: `Fraud ${key}`,
          category: 'B2C',
          clientId,
          defaults: { language: 'en', loiMinutes: 10, irPercent: 50, cpi: 2, targetCompletes: 500, liveSurveyUrl: 'https://client.example.com/s?rid={session_token}' },
          countries: [{ countryCode: 'US' }],
        })
        .expect(201)
    ).body;
    const c = p.countries[0];
    for (const v of vendorIds) await pm.post(`/projects/${p.id}/countries/${c.id}/allocations`, { vendorId: v, cpi: 1, targetCompletes: 500 }).expect(201);
    await pm.patch(`/projects/${p.id}/countries/${c.id}`, { status: 'LIVE' }).expect(200);
    await pm.patch(`/projects/${p.id}`, { status: 'LIVE' }).expect(200);
    const allocs = (await pm.get(`/projects/${p.id}`).expect(200)).body.countries[0].allocations.map((a: { entryCode: string; vendor: { code: string } }) => ({ entryCode: a.entryCode, vendorCode: a.vendor.code }));
    projects[key] = { id: p.id, allocs };
  }

  const setSecurity = (key: string, security: object, extra: object = {}) => pm.patch(`/projects/${projects[key].id}`, { security, ...extra }).expect(200);
  const session = (key: string, vendorRespondentId: string) => prisma.respondentSession.findFirstOrThrow({ where: { projectId: projects[key].id, vendorRespondentId } });
  const enter = (key: string, id: string, opts: { ip?: string; vendor?: number; ua?: string } = {}) =>
    http()
      .get(`/s/${projects[key].allocs[opts.vendor ?? 0].entryCode}?uid=${id}`)
      .set('User-Agent', opts.ua ?? DESKTOP)
      .set('X-Forwarded-For', opts.ip ?? `198.51.100.${n % 250}`)
      .expect(302);

  async function throughGate(key: string, id: string, body: Record<string, unknown>, opts: { vendor?: number; ua?: string } = {}) {
    const entry = await enter(key, id, opts);
    expect(entry.headers.location).toMatch(/\/g\//);
    const token = decodeURIComponent(entry.headers.location.split('/g/')[1]);
    const page = await http().get(`/g/${encodeURIComponent(token)}`).expect(200);
    const jar = ((page.headers['set-cookie'] as unknown as string[]) ?? []).map((c) => c.split(';')[0]);
    const res = await http().post(`/g/${encodeURIComponent(token)}`).set('Cookie', jar.join('; ')).send(body).expect(200);
    return { location: res.body.location as string, page, session: await session(key, id) };
  }

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await resetDb(prisma);
    await prisma.ipReputationRange.deleteMany({});
    await prisma.ipReputationSource.deleteMany({});
    await prisma.ipLookupCache.deleteMany({});
    rep = app.get(IpReputationService);
    const a = await makeOrg(prisma, 'fraud');
    orgId = a.org.id;
    const b = await makeOrg(prisma, 'fraud-other');
    pm = api(app, await login(app, a.users.PROJECT_MANAGER.email));
    admin = api(app, await login(app, a.users.ADMIN.email));
    other = api(app, await login(app, b.users.PROJECT_MANAGER.email));
    const c1 = (await pm.post('/clients', { name: 'Client one', code: 'FC1' }).expect(201)).body.id;
    const c2 = (await pm.post('/clients', { name: 'Client two', code: 'FC2' }).expect(201)).body.id;
    const v1 = (await pm.post('/vendors', { name: 'Panel One', code: 'P1' }).expect(201)).body.id;
    const v2 = (await pm.post('/vendors', { name: 'Panel Two', code: 'P2' }).expect(201)).body.id;
    await makeProject('a', c1, [v1, v2]);
    await makeProject('b', c1, [v1]);
    await makeProject('c', c2, [v2]);
  });

  afterAll(async () => {
    await prisma.ipReputationRange.deleteMany({});
    await prisma.ipReputationSource.deleteMany({});
    await app.close();
  });

  describe('IP and proxy reputation', () => {
    beforeAll(async () => {
      await rep.replace({ id: 'x4b-vpn', category: 'vpn' }, ['203.0.113.0/24']);
      await rep.replace({ id: 'x4b-datacenter', category: 'datacenter' }, ['192.0.2.0/24']);
      await rep.replace({ id: 'firehol-level1', category: 'abuse' }, ['198.18.0.7/32']);
    });

    it('rejects VPN, data centre and abusive addresses from the free lists', async () => {
      await setSecurity('a', { proxyDetection: true });
      const vpn = uid();
      await enter('a', vpn, { ip: '203.0.113.50' });
      expect(await session('a', vpn)).toMatchObject({ status: 'SECURITY_REJECT', statusDetail: 'PROXY_VPN' });
      const dc = uid();
      await enter('a', dc, { ip: '192.0.2.9' });
      expect(await session('a', dc)).toMatchObject({ status: 'SECURITY_REJECT', statusDetail: 'DATACENTER_IP', riskScore: 45, riskSignals: ['DATACENTER_IP'] });
      const abuse = uid();
      await enter('a', abuse, { ip: '198.18.0.7' });
      expect(await session('a', abuse)).toMatchObject({ statusDetail: 'IP_ABUSE' });
      const ok = uid();
      expect((await enter('a', ok, { ip: '198.51.100.77' })).headers.location).toMatch(/^https:\/\/client\.example\.com/);
      expect(await session('a', ok)).toMatchObject({ status: 'STARTED', riskScore: 0 });
    });

    it('skips the advanced checks when the plan does not include fraud checks', async () => {
      await setSecurity('a', { proxyDetection: true });
      const off = await prisma.featureOverride.create({ data: { organizationId: orgId, feature: 'fraud_checks', channel: 'web', enabled: false } });
      const vpn = uid();
      expect((await enter('a', vpn, { ip: '203.0.113.51' })).headers.location).toMatch(/^https:\/\/client\.example\.com/);
      expect(await session('a', vpn)).toMatchObject({ status: 'STARTED' });
      await prisma.featureOverride.delete({ where: { id: off.id } });
      const again = uid();
      await enter('a', again, { ip: '203.0.113.52' });
      expect(await session('a', again)).toMatchObject({ status: 'SECURITY_REJECT', statusDetail: 'PROXY_VPN' });
    });

    it('downloads the free lists, skips private ranges and keeps the old list when a download looks wrong', async () => {
      const saved = rep.http;
      const big = Array.from({ length: 30 }, (_, i) => `100.${i + 1}.0.0/16`).filter((x) => !x.startsWith('100.64'));
      rep.http = async (url) => {
        if (url.includes('datacenter')) return { status: 500, text: async () => '' };
        if (url.includes('firehol')) return { status: 200, text: async () => '# FireHOL\n10.0.0.0/8\n192.168.0.0/16\n' + ['198.18.0.7', ...big].join('\n') };
        return { status: 200, text: async () => ['203.0.113.0/24', ...big.map((x) => x.replace('100.', '101.'))].join('\n') };
      };
      try {
        const r = (await admin.post('/security/ip-lists/sync').expect(200)).body;
        expect(r.lists).toEqual([
          { id: 'x4b-vpn', count: 31, error: null },
          { id: 'x4b-datacenter', count: 0, error: 'HTTP 500' },
          { id: 'firehol-level1', count: 31, error: null },
        ]);
        expect(await prisma.ipReputationRange.count({ where: { source: 'x4b-datacenter' } })).toBe(1);
        expect(await rep.listHits('10.1.2.3')).toEqual([]);
        await pm.post('/security/ip-lists/sync').expect(403);
      } finally {
        rep.http = saved;
      }
    });

    it('uses the allow and block lists from Settings → Integrations, and checks them on save', async () => {
      expect((await admin.put('/integrations/settings/ip_reputation', { values: { IP_ALLOWLIST: '203.0.113.50, nonsense' } }).expect(400)).body.message).toMatch(/nonsense is not an IP address/);
      await admin.put('/integrations/settings/ip_reputation', { values: { IP_LISTS: 'on', IP_ALLOWLIST: '203.0.113.50', IP_BLOCKLIST: '198.51.100.200/30' } }).expect(200);
      const office = uid();
      await enter('a', office, { ip: '203.0.113.50' });
      expect(await session('a', office)).toMatchObject({ status: 'STARTED' });
      const blocked = uid();
      await enter('a', blocked, { ip: '198.51.100.201' });
      expect(await session('a', blocked)).toMatchObject({ status: 'SECURITY_REJECT', statusDetail: 'IP_BLOCKED' });
      // Public lists off: a VPN address gets in.
      await admin.put('/integrations/settings/ip_reputation', { values: { IP_LISTS: 'off', IP_ALLOWLIST: null, IP_BLOCKLIST: null } }).expect(200);
      const vpn = uid();
      await enter('a', vpn, { ip: '203.0.113.60' });
      expect(await session('a', vpn)).toMatchObject({ status: 'STARTED' });
      const st = (await pm.get('/security/status').expect(200)).body.ipReputation;
      expect(st).toMatchObject({ lists: false, proxycheck: false });
      expect(st.sources.find((s: { id: string }) => s.id === 'x4b-vpn')).toMatchObject({ count: 31 });
    });

    it('asks proxycheck.io with the free key, caches the answer and lets entries through when it fails', async () => {
      const integrations = app.get(IntegrationsService);
      const calls: string[] = [];
      const saved = rep.http;
      rep.http = async (url) => {
        calls.push(url);
        const ip = decodeURIComponent(new URL(url).pathname.split('/').pop()!);
        if (ip === '198.51.100.99') throw new Error('timeout');
        return { status: 200, text: async () => JSON.stringify({ status: 'ok', [ip]: ip === '198.51.100.88' ? { proxy: 'yes', type: 'SOCKS5' } : { proxy: 'no', type: 'Residential' } }) };
      };
      integrations.http = async () => ({ status: 200, text: async () => JSON.stringify({ status: 'ok', '8.8.8.8': { proxy: 'no' } }) });
      try {
        await admin.put('/integrations/settings/ip_reputation', { values: { IP_LISTS: 'on', PROXYCHECK_API_KEY: 'free-key-1234567890' } }).expect(200);
        const t = (await admin.post('/integrations/settings/ip_reputation/test').expect(200)).body;
        expect(t).toMatchObject({ ok: true });
        expect(t.message).toMatch(/Public lists loaded: .*proxycheck\.io accepted the key/);
        expect(JSON.stringify((await admin.get('/integrations/settings').expect(200)).body)).not.toContain('free-key-1234567890');

        const proxy = uid();
        await enter('a', proxy, { ip: '198.51.100.88' });
        expect(await session('a', proxy)).toMatchObject({ status: 'SECURITY_REJECT', statusDetail: 'PROXY_VPN' });
        const again = uid();
        await enter('a', again, { ip: '198.51.100.88' });
        expect(calls.filter((c) => c.includes('198.51.100.88'))).toHaveLength(1);
        expect(calls[0]).toContain('key=free-key-1234567890');
        const down = uid();
        await enter('a', down, { ip: '198.51.100.99' });
        expect(await session('a', down)).toMatchObject({ status: 'STARTED' });
        const ev = await prisma.respondentEvent.findFirstOrThrow({ where: { session: { vendorRespondentId: down }, type: 'SECURITY_CHECK' } });
        expect(JSON.stringify(ev.detail)).toContain('proxycheck.io: timeout');
      } finally {
        rep.http = saved;
        await admin.delete('/integrations/settings/ip_reputation').expect(200);
        await setSecurity('a', {});
      }
    });
  });

  describe('devices, vendors and projects', () => {
    it('rejects automated browsers', async () => {
      await setSecurity('a', { automationDetection: true });
      const bot = await throughGate('a', uid(), { signals: { ...CLEAN, webdriver: true } });
      expect(bot.session).toMatchObject({ status: 'SECURITY_REJECT', statusDetail: 'AUTOMATED_BROWSER' });
      const vm = await throughGate('a', uid(), { signals: { ...CLEAN, renderer: 'Google SwiftShader', platform: 'Linux x86_64' } });
      expect(vm.session).toMatchObject({ status: 'SECURITY_REJECT', statusDetail: 'AUTOMATED_BROWSER' });
      const person = await throughGate('a', uid(), { signals: CLEAN });
      expect(person.location).toMatch(/^https:\/\/client\.example\.com/);
      expect(person.page.text).toContain('out.signals=signals()');
    });

    it('catches the same device through another vendor, and by device hash after a browser update', async () => {
      await setSecurity('a', { browserFingerprinting: true });
      const first = await throughGate('a', uid(), { fingerprint: '11'.repeat(32), device: '21'.repeat(32) });
      expect(first.session).toMatchObject({ status: 'STARTED' });
      const otherVendor = await throughGate('a', uid(), { fingerprint: '11'.repeat(32), device: '21'.repeat(32) }, { vendor: 1 });
      expect(otherVendor.session).toMatchObject({ status: 'DUPLICATE', statusDetail: 'CROSS_VENDOR' });
      // New browser version (fingerprint changed), same device.
      const updated = await throughGate('a', uid(), { fingerprint: '12'.repeat(32), device: '21'.repeat(32) });
      expect(updated.session).toMatchObject({ status: 'DUPLICATE', statusDetail: 'SAME_FINGERPRINT' });
    });

    it('catches the same person across projects, within the rules picked', async () => {
      await setSecurity('a', { browserFingerprinting: true });
      const done = await throughGate('a', uid(), { fingerprint: '31'.repeat(32), device: '41'.repeat(32) });
      expect(done.session.status).toBe('STARTED');

      await setSecurity('b', { crossProjectDuplicates: true });
      const seen = await throughGate('b', uid(), { fingerprint: '31'.repeat(32), device: '41'.repeat(32) });
      expect(seen.session).toMatchObject({ status: 'DUPLICATE', statusDetail: 'SEEN_IN_OTHER_PROJECT' });
      expect(seen.page.text).toContain('"fingerprint":true');

      // Only completes count: the person in project a has not completed.
      await setSecurity('b', { crossProjectDuplicates: true }, { fraudRules: { crossProject: { outcomes: 'completes' } } });
      expect((await throughGate('b', uid(), { fingerprint: '31'.repeat(32) })).session.status).toBe('STARTED');
      // Listed projects that do not include a.
      await setSecurity('b', { crossProjectDuplicates: true }, { fraudRules: { crossProject: { scope: 'listed', projectIds: [projects.c.id] } } });
      expect((await throughGate('b', uid(), { device: '41'.repeat(32) })).session.status).toBe('STARTED');

      // Client scope: c belongs to another client, so project a does not count.
      await setSecurity('c', { crossProjectDuplicates: true }, { fraudRules: { crossProject: { scope: 'client' } } });
      expect((await throughGate('c', uid(), { device: '41'.repeat(32) })).session.status).toBe('STARTED');
      await setSecurity('c', { crossProjectDuplicates: true }, { fraudRules: { crossProject: { scope: 'all', days: 30 } } });
      expect((await throughGate('c', uid(), { device: '41'.repeat(32) })).session).toMatchObject({ status: 'DUPLICATE', statusDetail: 'SEEN_IN_OTHER_PROJECT' });
    });

    it('rejects at the risk threshold and keeps the score', async () => {
      await setSecurity('c', { automationDetection: true }, { fraudRules: { riskThreshold: 15 } });
      const r = await throughGate('c', uid(), { signals: { ...CLEAN, renderer: 'llvmpipe' } });
      expect(r.session).toMatchObject({ status: 'SECURITY_REJECT', statusDetail: 'HIGH_RISK', riskScore: 15, riskSignals: ['software-gpu'] });
      await setSecurity('c', { automationDetection: true }, { fraudRules: { riskThreshold: null } });
      const kept = await throughGate('c', uid(), { signals: { ...CLEAN, renderer: 'llvmpipe' } });
      expect(kept.session).toMatchObject({ status: 'STARTED', riskScore: 15 });
      const summary = (await pm.get(`/projects/${projects.c.id}/security-summary`).expect(200)).body;
      expect(summary.risk.low).toBeGreaterThanOrEqual(2);
      expect(summary.reasons.find((x: { reason: string }) => x.reason === 'HIGH_RISK')).toMatchObject({ label: 'Fraud risk score too high', count: 1 });
    });

    it('lists the same person across projects and vendors, for this organisation only', async () => {
      const r = (await pm.get(`/projects/${projects.a.id}/fraud/linked`).expect(200)).body;
      const crossProject = r.groups.find((g: { projects: number }) => g.projects >= 2);
      expect(crossProject.matchedBy).toContain('device');
      expect(crossProject.sessions.map((s: { projectCode: string }) => s.projectCode)).toEqual(expect.arrayContaining([expect.any(String)]));
      expect(crossProject.sessions.some((s: { here: boolean }) => !s.here)).toBe(true);
      const crossVendor = r.groups.find((g: { vendors: number; projects: number }) => g.vendors >= 2 && g.projects === 1);
      expect(crossVendor.sessions.map((s: { vendorCode: string }) => s.vendorCode).sort()).toEqual(expect.arrayContaining(['P1', 'P2']));
      await other.get(`/projects/${projects.a.id}/fraud/linked`).expect(404);
    });

    it('saves fraud rules with the project and refuses bad ones', async () => {
      await pm.patch(`/projects/${projects.b.id}`, { fraudRules: { riskThreshold: 5 } }).expect(400);
      await pm.patch(`/projects/${projects.b.id}`, { fraudRules: { crossProject: { scope: 'everyone' } } }).expect(400);
      await pm.patch(`/projects/${projects.b.id}`, { fraudRules: { crossProject: { scope: 'client', days: 60 }, riskThreshold: 80 } }).expect(200);
      expect((await pm.get(`/projects/${projects.b.id}`).expect(200)).body.fraudRules).toEqual({ crossProject: { scope: 'client', projectIds: [], days: 60, outcomes: 'any' }, riskThreshold: 80 });
    });
  });

  it('keeps captcha working next to the new checks', async () => {
    await setSecurity('b', { captcha: true, automationDetection: true }, { captchaStyle: 'invisible' });
    const entry = await enter('b', uid());
    const token = decodeURIComponent(entry.headers.location.split('/g/')[1]);
    const res = await http().post(`/g/${encodeURIComponent(token)}`).send({ nonce: solve(token), signals: CLEAN }).expect(200);
    expect(res.body.location).toMatch(/^https:\/\/client\.example\.com/);
  });
});
