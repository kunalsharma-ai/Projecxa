import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AiService } from '../../src/ai/ai.service';
import { Http } from '../../src/ai/provider';
import { api, createApp, login, makeOrg, resetDb } from './helpers';

type Req = { url: string; headers: Record<string, string>; body: Record<string, any> };
type Reply = { status?: number; body: unknown } | ((r: Req) => { status?: number; body: unknown });

/** A scripted Gemini: each generateContent call takes the next reply. */
function fakeGemini() {
  const calls: Req[] = [];
  const queue: Reply[] = [];
  const http: Http = async (url, init) => {
    const r: Req = { url, headers: init.headers, body: init.body ? JSON.parse(init.body) : null };
    calls.push(r);
    let next: Reply | undefined;
    if (url.includes('/auth_tokens')) next = { body: { name: 'auth_tokens/eph-123', expireTime: r.body.expireTime } };
    else next = queue.shift();
    if (!next) throw new Error(`Unexpected Gemini call ${url}`);
    const out = typeof next === 'function' ? next(r) : next;
    return { status: out.status ?? 200, json: async () => out.body, text: async () => JSON.stringify(out.body) };
  };
  const text = (t: string) => ({ body: { candidates: [{ content: { role: 'model', parts: [{ text: t }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 30 } } });
  const call = (name: string, args: object, sig = 'sig-1') => ({ body: { candidates: [{ content: { role: 'model', parts: [{ functionCall: { name, args }, thoughtSignature: sig }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 10, thoughtsTokenCount: 5 } } });
  return { http, calls, queue, text, call };
}

describe('AI copilot (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let svc: AiService;
  let admin: ReturnType<typeof api>;
  let pm: ReturnType<typeof api>;
  let viewer: ReturnType<typeof api>;
  let other: ReturnType<typeof api>;
  let g: ReturnType<typeof fakeGemini>;
  let org: string;
  let users: Record<string, { id: string; email: string }>;
  let projectId: string;
  const env = { ...process.env };

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    svc = app.get(AiService);
    await resetDb(prisma);
    const a = await makeOrg(prisma, 'ai');
    const b = await makeOrg(prisma, 'ai-other');
    org = a.org.id;
    users = a.users;
    admin = api(app, await login(app, a.users.ADMIN.email));
    pm = api(app, await login(app, a.users.PROJECT_MANAGER.email));
    viewer = api(app, await login(app, a.users.VIEWER.email));
    other = api(app, await login(app, b.users.ADMIN.email));
    const clientId = (await pm.post('/clients', { name: 'Acme Insights', code: 'ACME' }).expect(201)).body.id;
    const project = (await pm.post('/projects', { name: 'Brand tracker', category: 'B2C', clientId, defaults: { language: 'en', loiMinutes: 10, irPercent: 50, cpi: 10, targetCompletes: 100, currency: 'USD' }, countries: [{ countryCode: 'US' }] }).expect(201)).body;
    projectId = project.id;
    await pm.patch(`/projects/${projectId}`, { fieldStartAt: '2026-10-01', fieldEndAt: '2026-10-20' }).expect(200);
    await prisma.project.update({ where: { id: projectId }, data: { status: 'LIVE' } });
    // Tests ask many questions within a minute.
    await prisma.organization.update({ where: { id: org }, data: { aiSettings: { perUserPerMinute: 60 } } });
    const otherClient = (await other.post('/clients', { name: 'Secret Corp', code: 'SEC' }).expect(201)).body.id;
    await other.post('/projects', { name: 'Secret launch', category: 'B2C', clientId: otherClient, defaults: { language: 'en', loiMinutes: 10, irPercent: 50, cpi: 10, targetCompletes: 100 }, countries: [{ countryCode: 'GB' }] }).expect(201);
  });
  afterAll(async () => {
    process.env = env;
    await app.close();
  });
  beforeEach(() => {
    g = fakeGemini();
    svc.http = g.http;
  });

  const ask = (as: ReturnType<typeof api>, message: string, extra: object = {}) => as.post('/ai/chat', { message, ...extra });

  it('says it is not set up without a key', async () => {
    delete process.env.GEMINI_API_KEY;
    expect((await pm.get('/ai/status').expect(200)).body).toMatchObject({ configured: false, enabled: false, reason: 'not_configured' });
    expect((await ask(pm, 'hi').expect(503)).body.message).toMatch(/GEMINI_API_KEY/);
    process.env.GEMINI_API_KEY = 'test-key';
    process.env.AI_MODEL = 'gemini-test-flash';
    process.env.AI_FALLBACK_MODEL = 'gemini-test-lite';
    process.env.AI_LIVE_MODEL = 'gemini-test-live';
    expect((await pm.get('/ai/status').expect(200)).body).toMatchObject({ configured: true, enabled: true, model: 'gemini-test-flash', features: { actions: true, documents: true, voice: true } });
  });

  it('answers from real records through tools, replaying Gemini thought signatures', async () => {
    g.queue.push(g.call('delayed_projects', {}), g.text('Brand tracker is delayed: the field end date passed at 0 of 100 completes.'));
    const r = (await ask(pm, 'Which projects are delayed?', { path: `/projects/${projectId}` }).expect(200)).body;
    expect(r.messages.map((m: { role: string }) => m.role)).toEqual(['user', 'assistant']);
    const answer = r.messages[1];
    expect(answer.text).toMatch(/Brand tracker is delayed/);
    expect(answer.displays[0]).toMatchObject({ type: 'table', title: '1 delayed project' });
    expect(answer.displays[0].rows[0].why).toMatch(/field end 2026-10-20 passed at 0\/100/);

    const [first, second] = g.calls;
    expect(first.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-test-flash:generateContent');
    expect(first.headers['x-goog-api-key']).toBe('test-key');
    expect(first.body.systemInstruction.parts[0].text).toMatch(/Never invent/);
    expect(first.body.systemInstruction.parts[0].text).toMatch(/looking at project PRX\d+ "Brand tracker"/);
    const names = first.body.tools[0].functionDeclarations.map((f: { name: string }) => f.name);
    expect(names).toEqual(expect.arrayContaining(['list_projects', 'delayed_projects', 'team_workload', 'create_task']));
    // The model turn goes back exactly as Gemini sent it (with its signature), then the tool result.
    const model = second.body.contents.find((c: { role: string }) => c.role === 'model');
    expect(model.parts[0]).toMatchObject({ functionCall: { name: 'delayed_projects' }, thoughtSignature: 'sig-1' });
    const result = second.body.contents[second.body.contents.length - 1];
    expect(result.role).toBe('user');
    expect(result.parts[0].functionResponse).toMatchObject({ name: 'delayed_projects', id: model.parts[0].functionCall.id, response: { result: { count: 1 } } });
    expect(JSON.stringify(second.body)).not.toContain('Secret');

    const conv = (await pm.get(`/ai/conversations/${r.conversationId}`).expect(200)).body;
    expect(conv.messages).toHaveLength(2);
    await viewer.get(`/ai/conversations/${r.conversationId}`).expect(404);
    const usage = await prisma.aiUsage.findMany({ where: { userId: users.PROJECT_MANAGER.id } });
    expect(usage.map((x) => [x.kind, x.promptTokens, x.outputTokens])).toEqual([['chat', 100, 15], ['chat_tool', 120, 30]]);
  });

  it('only sees its own organisation', async () => {
    g.queue.push(g.call('project_details', { project: 'Secret launch' }), g.text('I cannot find that project.'));
    await ask(pm, 'Tell me about Secret launch').expect(200);
    expect(g.calls[1].body.contents.at(-1).parts[0].functionResponse.response.result).toEqual({ error: 'No project matches "Secret launch".' });
  });

  it('proposes a task, and creates it only when the person confirms', async () => {
    g.queue.push(g.call('create_task', { title: 'Send US quota update', assignee: 'viewer', project: 'Brand tracker', dueDate: '2026-11-20', priority: 'HIGH' }), g.text('I have prepared the task. Confirm it below.'));
    const r = (await ask(pm, 'Create a task for the viewer to send the US quota update by Nov 20').expect(200)).body;
    const action = r.messages[1].actions[0];
    expect(action).toMatchObject({ tool: 'create_task', status: 'pending', summary: expect.stringMatching(/^Create task "Send US quota update" for VIEWER on PRX\d+, due 2026-11-20, high priority$/) });
    expect(await prisma.task.count()).toBe(0);
    expect(g.calls[1].body.contents.at(-1).parts[0].functionResponse.response.result.status).toBe('waiting_for_confirmation');

    await viewer.post(`/ai/actions/${action.id}/confirm`).expect(404); // not theirs
    const done = (await pm.post(`/ai/actions/${action.id}/confirm`).expect(200)).body;
    expect(done.status).toBe('done');
    const task = await prisma.task.findFirstOrThrow();
    expect(task).toMatchObject({ title: 'Send US quota update', assigneeId: users.VIEWER.id, projectId, priority: 'HIGH', source: 'ai', createdById: users.PROJECT_MANAGER.id });
    expect(task.dueAt?.toISOString()).toBe('2026-11-20T23:59:59.000Z');
    await pm.post(`/ai/actions/${action.id}/confirm`).expect(400);
    expect(await prisma.auditEvent.count({ where: { action: { in: ['ai.action.proposed', 'ai.action.confirmed', 'task.create.ai'] } } })).toBe(3);
    // The conversation knows it happened, without showing the note on screen.
    const conv = (await pm.get(`/ai/conversations/${r.conversationId}`).expect(200)).body;
    expect(conv.messages[1].actions[0].status).toBe('done');
    expect(conv.messages).toHaveLength(2);
  });

  it('cancels, expires and re-checks permission at confirmation', async () => {
    g.queue.push(g.call('set_project_status', { project: 'Brand tracker', status: 'HOLD' }), g.text('Confirm below.'));
    const a = (await ask(pm, 'Put brand tracker on hold').expect(200)).body.messages[1].actions[0];
    expect(a.summary).toMatch(/Set PRX\d+ Brand tracker to HOLD/);
    expect((await pm.post(`/ai/actions/${a.id}/cancel`).expect(200)).body.status).toBe('cancelled');
    expect((await prisma.project.findUniqueOrThrow({ where: { id: projectId } })).status).toBe('LIVE');

    g.queue.push(g.call('run_fieldwork_check', {}), g.text('Confirm below.'));
    const b = (await ask(pm, 'Run the monitor').expect(200)).body.messages[1].actions[0];
    await prisma.aiAction.update({ where: { id: b.id }, data: { createdAt: new Date(Date.now() - 31 * 60_000) } });
    expect((await pm.post(`/ai/actions/${b.id}/confirm`).expect(400)).body.message).toMatch(/30 minutes/);

    // A viewer is not offered changing tools, and cannot use one if the model tries.
    g.queue.push(g.call('create_task', { title: 'x' }), g.text('I cannot do that.'));
    await ask(viewer, 'Create a task').expect(200);
    expect(g.calls.at(-2)!.body.tools[0].functionDeclarations.map((f: { name: string }) => f.name)).not.toContain('create_task');
    expect(g.calls.at(-1)!.body.contents.at(-1).parts[0].functionResponse.response.result.error).toMatch(/not available/);
  });

  it('shows workload and tasks from records', async () => {
    g.queue.push(g.call('team_workload', {}), g.text('VIEWER has one open high-priority task.'));
    const r = (await ask(admin, 'Who has the highest workload?').expect(200)).body.messages[1];
    expect(r.displays[0]).toMatchObject({ type: 'bars', title: 'Open tasks per person' });
    expect(r.displays[0].items.find((i: { label: string }) => i.label === 'VIEWER')).toMatchObject({ value: 1, tone: 'warn' });
    g.queue.push(g.call('list_tasks', { assignee: 'me' }), g.text('You have one task.'));
    const t = (await ask(viewer, 'What are my tasks?').expect(200)).body.messages[1];
    expect(t.displays[0].rows[0]).toMatchObject({ title: 'Send US quota update', assignee: 'VIEWER', priority: 'HIGH' });
  });

  it('reads uploaded files and keeps them private', async () => {
    const token = await login(app, users.PROJECT_MANAGER.email);
    const upload = (name: string, content: Buffer | string, type: string) => request(app.getHttpServer()).post('/api/v1/ai/documents').set('Authorization', `Bearer ${token}`).attach('file', Buffer.from(content), { filename: name, contentType: type });
    const txt = (await upload('brief.txt', 'Client wants 500 completes in DE by 30 November.', 'text/plain').expect(201)).body;
    const pdf = (await upload('rfp.pdf', '%PDF-1.4 fake', 'application/pdf').expect(201)).body;
    await upload('notes.docx', 'PK..', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document').expect(400);
    await upload('bad.pdf', 'not a pdf', 'application/pdf').expect(400);
    g.queue.push(g.text('The brief asks for 500 completes in Germany by 30 November. Missing: LOI, incidence and CPI.'));
    const r = (await ask(pm, 'Extract the requirements and what is missing', { documentIds: [txt.id, pdf.id] }).expect(200)).body;
    expect(r.messages[0].documents.map((d: { name: string }) => d.name)).toEqual(['brief.txt', 'rfp.pdf']);
    const parts = g.calls[0].body.contents.at(-1).parts;
    expect(parts[1].text).toMatch(/\[Attached file: brief.txt\]\nClient wants 500 completes/);
    expect(parts[3]).toEqual({ inlineData: { mimeType: 'application/pdf', data: Buffer.from('%PDF-1.4 fake').toString('base64') } });
    // Another person cannot attach someone else's file.
    await ask(admin, 'Read this', { documentIds: [txt.id] }).expect(400);
    expect((await admin.get('/ai/documents').expect(200)).body).toEqual([]);
  });

  it('falls back to the lighter model when Gemini is busy, and reports when both are', async () => {
    g.queue.push({ status: 429, body: { error: { code: 429, message: 'Resource exhausted', status: 'RESOURCE_EXHAUSTED' } } }, g.text('Hello.'));
    await ask(pm, 'Hello').expect(200);
    expect(g.calls[1].url).toContain('/models/gemini-test-lite:generateContent');
    g.queue.push({ status: 429, body: { error: { message: 'x' } } }, { status: 429, body: { error: { message: 'x' } } });
    const r = await ask(pm, 'Hello again').expect(429);
    expect(r.body.message).toMatch(/busy or the free daily allowance/);
    expect(await prisma.aiUsage.count({ where: { ok: false } })).toBe(3);
  });

  it('enforces per-person limits and admin settings', async () => {
    const s = (await admin.get('/ai/status').expect(200)).body.settings;
    expect(s).toMatchObject({ enabled: true, perUserDaily: 100, perUserPerMinute: 60 });
    expect((await pm.get('/ai/status').expect(200)).body.settings).toBeUndefined();
    await pm.put('/ai/settings', s).expect(403);
    await prisma.aiUsage.deleteMany({ where: { userId: users.VIEWER.id } });
    await admin.put('/ai/settings', { ...s, perUserPerMinute: 1 }).expect(200);
    g.queue.push(g.text('ok'));
    await ask(viewer, 'one').expect(200);
    expect((await ask(viewer, 'two').expect(429)).body.message).toMatch(/in a minute/);
    await admin.put('/ai/settings', { ...s, roles: ['ADMIN', 'PROJECT_MANAGER'] }).expect(200);
    expect((await ask(viewer, 'three').expect(403)).body.message).toMatch(/not available for your role/);
    expect((await viewer.get('/ai/status').expect(200)).body).toMatchObject({ enabled: false, reason: 'role' });
    await admin.put('/ai/settings', { ...s, actions: false, voice: false }).expect(200);
    g.queue.push(g.text('ok'));
    await ask(pm, 'tools?').expect(200);
    expect(g.calls[0].body.tools[0].functionDeclarations.map((f: { name: string }) => f.name)).not.toContain('create_task');
    await pm.post('/ai/voice/session', {}).expect(403);
    await admin.put('/ai/settings', s).expect(200);
    const usage = (await admin.get('/ai/usage').expect(200)).body;
    expect(usage.today[0].requests).toBeGreaterThan(0);
    expect(usage.recentErrors.length).toBeGreaterThan(0);
  });

  it('starts a live voice session with a short-lived token and runs its tools on the server', async () => {
    const v = (await pm.post('/ai/voice/session', { path: '/' }).expect(200)).body;
    expect(v.url).toBe('wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained?access_token=auth_tokens%2Feph-123');
    expect(v.url).not.toContain('test-key');
    expect(v.setup.setup).toMatchObject({ model: 'models/gemini-test-live', generationConfig: { responseModalities: ['AUDIO'] }, inputAudioTranscription: {}, outputAudioTranscription: {} });
    const tokenReq = g.calls[0];
    expect(tokenReq.url).toBe('https://generativelanguage.googleapis.com/v1beta/auth_tokens');
    expect(tokenReq.body).toMatchObject({ uses: 1, liveConnectConstraints: { model: 'models/gemini-test-live', config: { responseModalities: ['AUDIO'] } } });
    expect(tokenReq.body.liveConnectConstraints.config.systemInstruction.parts[0].text).toMatch(/spoken aloud/);

    const t = (await pm.post('/ai/voice/tool', { conversationId: v.conversationId, name: 'list_projects', args: { status: 'ACTIVE' } }).expect(200)).body;
    expect(t.response.total).toBe(1);
    expect(t.displays[0].rows[0].name).toBe('Brand tracker');
    const act = (await pm.post('/ai/voice/tool', { conversationId: v.conversationId, name: 'create_task', args: { title: 'Call Acme' } }).expect(200)).body;
    expect(act.action).toMatchObject({ status: 'pending', summary: 'Create task "Call Acme"' });
    await pm.post('/ai/voice/turn', { conversationId: v.conversationId, userText: 'Show me all active projects', assistantText: 'You have one active project, Brand tracker.' }).expect(200);
    const conv = (await pm.get(`/ai/conversations/${v.conversationId}`).expect(200)).body;
    expect(conv.title).toBe('🎙 Show me all active projects');
    expect(conv.messages.map((m: { role: string; text: string }) => [m.role, m.text])).toEqual([['user', 'Show me all active projects'], ['assistant', 'You have one active project, Brand tracker.']]);
    expect(conv.messages[1].displays).toHaveLength(1);
    expect(conv.messages[1].actions[0].summary).toBe('Create task "Call Acme"');
    await viewer.post('/ai/voice/tool', { conversationId: v.conversationId, name: 'list_projects', args: {} }).expect(404);
  });

  it('writes down a tap-to-talk question from the phone app', async () => {
    const token = await login(app, users.PROJECT_MANAGER.email);
    const send = (body: Buffer, type: string) => request(app.getHttpServer()).post('/api/v1/ai/voice/transcribe').set('Authorization', `Bearer ${token}`).attach('audio', body, { filename: 'q.wav', contentType: type });
    const wav = Buffer.concat([Buffer.from('RIFF....WAVEfmt '), Buffer.alloc(64)]);
    g.queue.push(g.text('"Which projects are behind pace?"'));
    expect((await send(wav, 'audio/wav').expect(200)).body).toEqual({ text: 'Which projects are behind pace?' });
    const req = g.calls[0].body;
    expect(req.tools).toBeUndefined();
    expect(req.systemInstruction.parts[0].text).toMatch(/write down speech/i);
    expect(req.contents[0].parts.find((p: { inlineData?: unknown }) => p.inlineData)).toEqual({ inlineData: { mimeType: 'audio/wav', data: wav.toString('base64') } });
    expect(await prisma.aiUsage.count({ where: { userId: users.PROJECT_MANAGER.id, kind: 'voice', ok: true } })).toBeGreaterThan(0);
    await send(Buffer.from('hello'), 'text/plain').expect(400);
    await request(app.getHttpServer()).post('/api/v1/ai/voice/transcribe').set('Authorization', `Bearer ${token}`).expect(400);
    // Off when the organisation turned voice off.
    const s = (await admin.get('/ai/status').expect(200)).body.settings;
    await admin.put('/ai/settings', { ...s, voice: false }).expect(200);
    await send(wav, 'audio/wav').expect(403);
    await admin.put('/ai/settings', { ...s, voice: true }).expect(200);
  });

  it('is not available to client or vendor portal users', async () => {
    const c = await prisma.client.findFirstOrThrow({ where: { organizationId: org } });
    await admin.post('/portal-users', { kind: 'client', partyId: c.id, email: 'portal@acme.test', name: 'Portal', password: 'a-long-portal-pass' }).expect(201);
    const token = (await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email: 'portal@acme.test', password: 'a-long-portal-pass' }).expect(200)).body.token;
    await request(app.getHttpServer()).post('/api/v1/ai/chat').set('Authorization', `Bearer ${token}`).send({ message: 'hi' }).expect(403);
  });
});
