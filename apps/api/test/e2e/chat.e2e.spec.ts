import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '../../src/prisma/client';
import { ChatService } from '../../src/chat/chat';
import { api, createApp, login, makeOrg, resetDb } from './helpers';

describe('Team chat (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let admin: ReturnType<typeof api>;
  let pm: ReturnType<typeof api>;
  let viewer: ReturnType<typeof api>;
  let other: ReturnType<typeof api>;
  let users: Record<string, { id: string; email: string }>;
  let orgId: string;
  let otherUser: string;
  let projectId: string;
  let projectCode: string;

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await resetDb(prisma);
    const a = await makeOrg(prisma, 'chat');
    const b = await makeOrg(prisma, 'chat-other');
    users = a.users;
    orgId = a.org.id;
    otherUser = b.users.VIEWER.id;
    admin = api(app, await login(app, a.users.ADMIN.email));
    pm = api(app, await login(app, a.users.PROJECT_MANAGER.email));
    viewer = api(app, await login(app, a.users.VIEWER.email));
    other = api(app, await login(app, b.users.PROJECT_MANAGER.email));
    // Team chat starts as admins only; these admins give it and every option to their whole team.
    for (const t of [admin, api(app, await login(app, b.users.ADMIN.email))]) {
      for (const f of ['chat', 'chat.general', 'chat.project_rooms', 'chat.groups', 'chat.direct']) await t.put(`/feature-access/${f}`, { mode: 'everyone' }).expect(200);
    }
    const clientId = (await pm.post('/clients', { name: 'Acme', code: 'ACME' }).expect(201)).body.id;
    const p = (await pm.post('/projects', { name: 'Brand tracker', category: 'B2C', clientId, defaults: { language: 'en', loiMinutes: 10, irPercent: 50, cpi: 5, targetCompletes: 10, liveSurveyUrl: 'https://client.example.com/s?rid={session_token}' }, countries: [{ countryCode: 'US' }] }).expect(201)).body;
    projectId = p.id;
    projectCode = p.projectCode;
  });
  afterAll(() => app.close());

  const find = (list: { kind: string; id: string }[], kind: string) => list.find((c) => c.kind === kind)!;

  it('everyone has General and Announcements; only admins post announcements', async () => {
    const list = (await pm.get('/chat/channels').expect(200)).body;
    expect(list.map((c: { kind: string }) => c.kind)).toEqual(['ANNOUNCEMENTS', 'GENERAL']);
    const ann = find(list, 'ANNOUNCEMENTS');
    expect(ann).toMatchObject({ canPost: false, adminsOnly: true });
    await pm.post(`/chat/channels/${ann.id}/messages`, { body: 'Hi all' }).expect(403);
    await admin.post(`/chat/channels/${ann.id}/messages`, { body: 'Office closed Friday' }).expect(201);
    const general = find(list, 'GENERAL');
    await viewer.post(`/chat/channels/${general.id}/messages`, { body: 'Morning team' }).expect(201);
    const after = (await pm.get('/chat/channels').expect(200)).body;
    expect(find(after, 'ANNOUNCEMENTS')).toMatchObject({ unread: 1, lastMessage: { body: 'Office closed Friday', author: { role: 'ADMIN' } } });
    // Another organisation never sees these.
    const theirs = (await other.get('/chat/channels').expect(200)).body;
    expect(theirs.map((c: { id: string }) => c.id)).not.toContain(general.id);
    await other.get(`/chat/channels/${general.id}/messages`).expect(404);
    await other.post(`/chat/channels/${general.id}/messages`, { body: 'x' }).expect(404);
  });

  it('a message queued offline and sent twice is saved once', async () => {
    const general = find((await pm.get('/chat/channels').expect(200)).body, 'GENERAL');
    const first = (await pm.post(`/chat/channels/${general.id}/messages`, { body: 'Written on the train', clientId: 'offline-0001' }).expect(201)).body;
    const again = (await pm.post(`/chat/channels/${general.id}/messages`, { body: 'Written on the train', clientId: 'offline-0001' }).expect(201)).body;
    expect(again.id).toBe(first.id);
    expect(await prisma.chatMessage.count({ where: { clientId: 'offline-0001' } })).toBe(1);
  });

  it('sync returns what was missed, including edits and deletions', async () => {
    const general = find((await viewer.get('/chat/channels').expect(200)).body, 'GENERAL');
    const base = (await viewer.get('/chat/sync').expect(200)).body;
    expect(base.items.length).toBeGreaterThanOrEqual(3);
    const mark = base.latestSeq;
    const since = base.serverTime;
    const m = (await pm.post(`/chat/channels/${general.id}/messages`, { body: 'While you were away' }).expect(201)).body;
    const old = base.items.find((i: { body: string }) => i.body === 'Written on the train');
    await new Promise((r) => setTimeout(r, 5));
    await pm.patch(`/chat/messages/${old.id}`, { body: 'Written on the train (edited)' }).expect(200);
    await viewer.patch(`/chat/messages/${m.id}`, { body: 'not mine' }).expect(403);
    const s = (await viewer.get(`/chat/sync?after=${mark}&changedSince=${encodeURIComponent(since)}`).expect(200)).body;
    expect(s.items.map((i: { body: string }) => i.body)).toEqual(['Written on the train (edited)', 'While you were away']);
    expect(s.latestSeq).toBe(m.seq);
    // Admins may remove anyone's message; the text is gone for everyone.
    const del = (await admin.delete(`/chat/messages/${m.id}`).expect(200)).body;
    expect(del).toMatchObject({ body: '', deletedAt: expect.any(String) });
    await viewer.delete(`/chat/messages/${old.id}`).expect(403);
  });

  it('read position only moves forward', async () => {
    const general = find((await viewer.get('/chat/channels').expect(200)).body, 'GENERAL');
    const { items } = (await viewer.get(`/chat/channels/${general.id}/messages`).expect(200)).body;
    const top = items[items.length - 1].seq;
    await viewer.post(`/chat/channels/${general.id}/read`, { seq: top }).expect(200);
    await viewer.post(`/chat/channels/${general.id}/read`, { seq: 1 }).expect(200);
    expect(find((await viewer.get('/chat/channels').expect(200)).body, 'GENERAL')).toMatchObject({ unread: 0, readSeq: top });
  });

  it('direct messages are private to the two people', async () => {
    await pm.post('/chat/direct', { userId: otherUser }).expect(400);
    await pm.post('/chat/direct', { userId: users.PROJECT_MANAGER.id }).expect(400);
    const dm = (await pm.post('/chat/direct', { userId: users.VIEWER.id }).expect(201)).body;
    expect(dm).toMatchObject({ kind: 'DIRECT', name: 'VIEWER' });
    const same = (await viewer.post('/chat/direct', { userId: users.PROJECT_MANAGER.id }).expect(201)).body;
    expect(same.id).toBe(dm.id);
    await pm.post(`/chat/channels/${dm.id}/messages`, { body: 'Can you check DE quotas?' }).expect(201);
    expect((await viewer.get(`/chat/channels/${dm.id}/messages`).expect(200)).body.items).toHaveLength(1);
    // Not even an admin reads someone else's direct messages.
    await admin.get(`/chat/channels/${dm.id}/messages`).expect(404);
    expect((await admin.get('/chat/channels').expect(200)).body.map((c: { id: string }) => c.id)).not.toContain(dm.id);
    const sync = (await admin.get('/chat/sync').expect(200)).body;
    expect(sync.items.map((i: { channelId: string }) => i.channelId)).not.toContain(dm.id);
  });

  it('groups: members only; the maker or an admin adds people', async () => {
    const g = (await viewer.post('/chat/groups', { name: 'DE launch', userIds: [users.PROJECT_MANAGER.id] }).expect(201)).body;
    expect(g.members.map((m: { id: string }) => m.id).sort()).toEqual([users.PROJECT_MANAGER.id, users.VIEWER.id].sort());
    await admin.get(`/chat/channels/${g.id}/messages`).expect(404);
    await pm.post(`/chat/channels/${g.id}/members`, { userIds: [users.ADMIN.id] }).expect(403);
    await viewer.post(`/chat/channels/${g.id}/members`, { userIds: [otherUser] }).expect(400);
    await viewer.post(`/chat/channels/${g.id}/members`, { userIds: [users.ADMIN.id] }).expect(200);
    await admin.post(`/chat/channels/${g.id}/messages`, { body: 'Joined' }).expect(201);
    await pm.delete(`/chat/channels/${g.id}/members/me`).expect(200);
    await pm.get(`/chat/channels/${g.id}/messages`).expect(404);
  });

  it('project rooms carry status updates; admins can lock and archive them', async () => {
    await other.post(`/chat/projects/${projectId}`).expect(404);
    const room = (await viewer.post(`/chat/projects/${projectId}`).expect(200)).body;
    expect(room).toMatchObject({ kind: 'PROJECT', name: `${projectCode} · Brand tracker`, project: { id: projectId } });
    expect((await pm.post(`/chat/projects/${projectId}`).expect(200)).body.id).toBe(room.id);
    await pm.post(`/chat/channels/${room.id}/messages`, { body: 'Field started', type: 'UPDATE' }).expect(400);
    const up = (await pm.post(`/chat/channels/${room.id}/messages`, { body: 'DE is behind pace, adding a vendor', type: 'UPDATE', tone: 'at_risk' }).expect(201)).body;
    expect(up).toMatchObject({ type: 'UPDATE', tone: 'at_risk' });
    const general = find((await pm.get('/chat/channels').expect(200)).body, 'GENERAL');
    await pm.post(`/chat/channels/${general.id}/messages`, { body: 'x', type: 'UPDATE', tone: 'done' }).expect(400);

    await pm.patch(`/chat/channels/${room.id}`, { adminsOnly: true }).expect(403);
    await admin.patch(`/chat/channels/${room.id}`, { adminsOnly: true }).expect(200);
    await pm.post(`/chat/channels/${room.id}/messages`, { body: 'Locked?' }).expect(403);
    await admin.patch(`/chat/channels/${room.id}`, { adminsOnly: false, archived: true }).expect(200);
    await pm.post(`/chat/channels/${room.id}/messages`, { body: 'Archived?' }).expect(403);
    await admin.patch(`/chat/channels/${general.id}`, { archived: true }).expect(400);
    // Anyone can mute a conversation for themselves.
    expect((await viewer.patch(`/chat/channels/${general.id}`, { muted: true }).expect(200)).body.muted).toBe(true);
  });

  it('the live stream sends each person only what they may see', async () => {
    const chat = app.get(ChatService);
    const seen: { type: string; data: unknown }[] = [];
    const sub = chat.stream({ id: users.ADMIN.id, organizationId: orgId, role: 'ADMIN', email: users.ADMIN.email, name: 'ADMIN' }).subscribe((e) => seen.push(e as { type: string; data: unknown }));
    expect((await pm.get('/chat/people').expect(200)).body.find((p: { id: string }) => p.id === users.ADMIN.id).online).toBe(true);
    const general = find((await pm.get('/chat/channels').expect(200)).body, 'GENERAL');
    const dm = (await pm.post('/chat/direct', { userId: users.VIEWER.id }).expect(201)).body;
    await pm.post(`/chat/channels/${general.id}/messages`, { body: 'Live hello' }).expect(201);
    await pm.post(`/chat/channels/${dm.id}/messages`, { body: 'Secret' }).expect(201);
    sub.unsubscribe();
    const bodies = seen.filter((e) => e.type === 'message').map((e) => (e.data as { body: string }).body);
    expect(bodies).toEqual(['Live hello']);
    expect(seen[0].type).toBe('hello');
    expect((await pm.get('/chat/people').expect(200)).body.find((p: { id: string }) => p.id === users.ADMIN.id).online).toBe(false);
  });

  it('Super Admin → Admin → users: chat and each option follow Features & access', async () => {
    const t = await makeOrg(prisma, 'chat-layers');
    const tAdmin = api(app, await login(app, t.users.ADMIN.email));
    const tPm = api(app, await login(app, t.users.PROJECT_MANAGER.email));
    const tViewer = api(app, await login(app, t.users.VIEWER.email));
    // Before the Admin decides, only admins have chat, with every option.
    expect((await tAdmin.get('/chat/me').expect(200)).body).toEqual({ enabled: true, options: ['general', 'project_rooms', 'groups', 'direct'] });
    expect((await tPm.get('/chat/me').expect(403)).body.code).toBe('FEATURE_DISABLED');
    await tPm.get('/chat/channels').expect(403);

    // The Admin gives chat to the viewer only, without any options: they read Announcements and General.
    await tAdmin.put('/feature-access/chat', { mode: 'people', people: [t.users.VIEWER.id] }).expect(200);
    expect((await tViewer.get('/chat/me').expect(200)).body).toEqual({ enabled: true, options: [] });
    await tPm.get('/chat/channels').expect(403);
    const list = (await tViewer.get('/chat/channels').expect(200)).body;
    expect(list.map((c: { kind: string }) => c.kind)).toEqual(['ANNOUNCEMENTS', 'GENERAL']);
    const general = find(list, 'GENERAL') as unknown as { id: string; canPost: boolean; postBlock: string };
    expect(general.canPost).toBe(false);
    expect(general.postBlock).toMatch(/read General/);
    await tViewer.post(`/chat/channels/${general.id}/messages`, { body: 'hi' }).expect(403);
    await tViewer.post('/chat/direct', { userId: t.users.ADMIN.id }).expect(403);
    await tViewer.post('/chat/groups', { name: 'x', userIds: [t.users.ADMIN.id] }).expect(403);
    // Only people with chat show up, and you cannot message someone without direct messages.
    expect((await tAdmin.get('/chat/people').expect(200)).body.map((p: { id: string }) => p.id).sort()).toEqual([t.users.ADMIN.id, t.users.VIEWER.id].sort());
    await tAdmin.post('/chat/direct', { userId: t.users.PROJECT_MANAGER.id }).expect(400);
    await tAdmin.post('/chat/direct', { userId: t.users.VIEWER.id }).expect(400);

    // Turning on options one by one.
    await tAdmin.put('/feature-access/chat.general', { mode: 'people', people: [t.users.VIEWER.id] }).expect(200);
    await tAdmin.put('/feature-access/chat.direct', { mode: 'people', people: [t.users.VIEWER.id] }).expect(200);
    await tViewer.post(`/chat/channels/${general.id}/messages`, { body: 'Hello from the viewer' }).expect(201);
    const dm = (await tViewer.post('/chat/direct', { userId: t.users.ADMIN.id }).expect(201)).body;
    await tViewer.post('/chat/groups', { name: 'x', userIds: [t.users.ADMIN.id] }).expect(403);

    // Super Admin layer: taking chat away from the organisation takes it from the admins and their users too.
    await prisma.featureOverride.create({ data: { organizationId: t.org.id, feature: 'chat', channel: 'web', enabled: false } });
    expect((await tAdmin.get('/chat/channels').expect(403)).body.code).toBe('FEATURE_DISABLED');
    await tViewer.get(`/chat/channels/${dm.id}/messages`).expect(403);
  });
});
