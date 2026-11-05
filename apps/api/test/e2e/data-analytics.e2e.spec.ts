import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { api, createApp, login, makeOrg, resetDb } from './helpers';

describe('Data processing and analytics (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let pm: ReturnType<typeof api>;
  let other: ReturnType<typeof api>;
  let projectId: string;
  const http = () => request(app.getHttpServer());

  async function run(code: string, uid: string, status?: string) {
    const entry = await http().get(`/s/${code}?uid=${uid}`).expect(302);
    if (!status) return;
    const token = new URL(entry.headers.location).searchParams.get('rid')!;
    await http().get(`/r/${status}?token=${token}`).expect(302);
  }

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await resetDb(prisma);
    const a = await makeOrg(prisma, 'da-a');
    const b = await makeOrg(prisma, 'da-b');
    pm = api(app, await login(app, a.users.PROJECT_MANAGER.email));
    other = api(app, await login(app, b.users.PROJECT_MANAGER.email));

    const client = (await pm.post('/clients', { name: 'Client D', code: 'CD' }).expect(201)).body.id;
    const vendor = (await pm.post('/vendors', { name: 'Vendor D', code: 'VD' }).expect(201)).body.id;
    const proj = (
      await pm
        .post('/projects', {
          name: 'Analytics study',
          category: 'B2C',
          clientId: client,
          defaults: { language: 'en', loiMinutes: 12, irPercent: 40, cpi: 9, targetCompletes: 10, liveSurveyUrl: 'https://client.example.com/s?rid={session_token}' },
          countries: [{ countryCode: 'US' }],
        })
        .expect(201)
    ).body;
    projectId = proj.id;
    const c = proj.countries[0];
    await pm.post(`/projects/${proj.id}/countries/${c.id}/allocations`, { vendorId: vendor, cpi: 3, targetCompletes: 10 }).expect(201);
    await pm.patch(`/projects/${proj.id}/countries/${c.id}`, { status: 'LIVE' }).expect(200);
    await pm.patch(`/projects/${proj.id}`, { status: 'LIVE' }).expect(200);
    const code = (await pm.get(`/projects/${proj.id}`).expect(200)).body.countries[0].allocations[0].entryCode;

    await run(code, 'R-1', 'complete');
    await run(code, 'R-2', 'complete');
    await run(code, 'R-3', 'complete');
    await run(code, 'R-4', 'terminate');
    await run(code, 'R-5', 'quality');
    await run(code, 'R-6'); // still in the survey

    // Gate answers as the gate page stores them (gender + age), and one rejected complete.
    await prisma.project.update({
      where: { id: proj.id },
      data: {
        gateQuestions: [
          { id: 'gender', type: 'single', text: 'Gender?', required: true, options: [{ id: 'm', label: 'Male', action: 'accept' }, { id: 'f', label: 'Female', action: 'accept' }], validation: {} },
          { id: 'age', type: 'number', text: 'Age?', required: true, validation: {} },
        ],
      },
    });
    const ans = (g: string, age: number) => ({ gate: { gender: { value: g, label: g === 'm' ? 'Male' : 'Female' }, age: { value: age, label: String(age) } } });
    await prisma.respondentSession.update({ where: { vendorAllocationId_vendorRespondentId_isTest: { vendorAllocationId: (await prisma.vendorAllocation.findFirstOrThrow({ where: { vendorId: vendor } })).id, vendorRespondentId: 'R-1', isTest: false } }, data: { answers: ans('m', 25) } });
    await prisma.respondentSession.updateMany({ where: { vendorRespondentId: 'R-2' }, data: { answers: ans('f', 40) } });
    await prisma.respondentSession.updateMany({ where: { vendorRespondentId: 'R-3' }, data: { answers: ans('f', 60) } });
    const r3 = await prisma.respondentSession.findFirstOrThrow({ where: { vendorRespondentId: 'R-3' } });
    await pm.post(`/projects/${proj.id}/sessions/approval`, { sessionIds: [r3.id], approval: 'REJECTED' }).expect(201);
  });

  afterAll(async () => {
    await app.close();
  });

  it('shows the processing pipeline from real sessions', async () => {
    const d = (await pm.get(`/data-processing?projectId=${projectId}`).expect(200)).body;
    expect(d.project.id).toBe(projectId);
    expect(d.counts).toMatchObject({ entrants: 6, finished: 5, completes: 3, rejected: 1, checkRejects: 1 });
    const stage = (id: string) => d.stages.find((s: { id: string }) => s.id === id);
    expect(stage('intake')).toMatchObject({ done: 5, total: 6 });
    expect(stage('quality')).toMatchObject({ done: 5, total: 6 });
    expect(stage('review').done).toBe(1);
    expect(d.vendors).toHaveLength(1);
    expect(d.vendors[0]).toMatchObject({ entrants: 6, completes: 3, qualityFails: 1, rejectedCompletes: 1 });
    expect(d.flagged.map((f: { status: string }) => f.status).sort()).toEqual(['COMPLETE', 'QUALITY_FAIL']);
    // Defaults to a project with traffic when none is given.
    expect((await pm.get('/data-processing').expect(200)).body.project.id).toBe(projectId);
  });

  it('exports clean data without rejected completes', async () => {
    const c = (await pm.get(`/data-processing/clean?projectId=${projectId}`).expect(200)).body;
    expect(c.total).toBe(2);
    expect(c.rows.map((r: { vendorRespondentId: string }) => r.vendorRespondentId).sort()).toEqual(['R-1', 'R-2']);
    expect(c.columns.map((x: { key: string }) => x.key)).toEqual(['gate:gender', 'gate:age']);
    expect(c.rows.find((r: { vendorRespondentId: string }) => r.vendorRespondentId === 'R-1').answers['gate:gender']).toBe('Male');
  });

  it('builds KPIs, distributions and crosstabs from answers', async () => {
    const a = (await pm.get(`/analytics?projectId=${projectId}&row=gate:gender&col=device&focus=gate:gender`).expect(200)).body;
    expect(a.kpis).toMatchObject({ completes: 3, target: 10, incidence: 75 });
    expect(a.focus.answered).toBe(3);
    expect(a.focus.items).toEqual([{ label: 'Male', count: 1, percent: 33.3 }, { label: 'Female', count: 2, percent: 66.7 }]);
    expect(a.crosstab.base).toBe(3);
    expect(a.crosstab.rows.map((r: { label: string; total: number }) => [r.label, r.total])).toEqual([['Male', 1], ['Female', 2]]);
    // Numbers are grouped into ranges; every complete lands in one.
    const age = a.analysis.find((x: { key: string }) => x.key === 'gate:age');
    expect(age.items.reduce((s: number, i: { count: number }) => s + i.count, 0)).toBe(3);
    expect(a.trend).toHaveLength(30);

    // Base "every entrant" counts all six sessions.
    expect((await pm.get(`/analytics?projectId=${projectId}&base=all`).expect(200)).body.baseCount).toBe(6);
    await pm.get(`/analytics?projectId=${projectId}&row=nonsense`).expect(400);
  });

  it('keeps every organisation to its own projects', async () => {
    await other.get(`/data-processing?projectId=${projectId}`).expect(404);
    await other.get(`/analytics?projectId=${projectId}`).expect(404);
    await other.get(`/data-processing/clean?projectId=${projectId}`).expect(404);
    expect((await other.get('/analytics').expect(200)).body.project).toBeNull();
  });

  it('follows the Super Admin feature switches', async () => {
    const u = await prisma.user.findFirstOrThrow({ where: { email: 'project_manager@da-a.test' } });
    await prisma.user.update({ where: { id: u.id }, data: { featuresOff: ['analytics'] } });
    await pm.get(`/analytics?projectId=${projectId}`).expect(403);
    await pm.get(`/data-processing?projectId=${projectId}`).expect(200);
    await prisma.user.update({ where: { id: u.id }, data: { featuresOff: ['data_processing'] } });
    await pm.get(`/data-processing?projectId=${projectId}`).expect(403);
    await pm.get(`/data-processing/clean?projectId=${projectId}`).expect(403);
    await pm.get(`/analytics?projectId=${projectId}`).expect(200);
    await prisma.user.update({ where: { id: u.id }, data: { featuresOff: [] } });
  });
});
