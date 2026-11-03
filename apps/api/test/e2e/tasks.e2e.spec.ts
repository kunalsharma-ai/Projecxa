import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { api, createApp, login, makeOrg, resetDb } from './helpers';

describe('Tasks (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let pm: ReturnType<typeof api>;
  let viewer: ReturnType<typeof api>;
  let other: ReturnType<typeof api>;
  let users: Record<string, { id: string; email: string }>;
  let otherUser: string;

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await resetDb(prisma);
    const a = await makeOrg(prisma, 'tasks');
    const b = await makeOrg(prisma, 'tasks-other');
    users = a.users;
    otherUser = b.users.VIEWER.id;
    pm = api(app, await login(app, a.users.PROJECT_MANAGER.email));
    viewer = api(app, await login(app, a.users.VIEWER.email));
    other = api(app, await login(app, b.users.PROJECT_MANAGER.email));
  });
  afterAll(() => app.close());

  it('editors create and assign; assignees update their own status only', async () => {
    await viewer.post('/tasks', { title: 'Nope' }).expect(403);
    await pm.post('/tasks', { title: 'Cross-org', assigneeId: otherUser }).expect(400);
    const a = (await pm.post('/tasks', { title: 'Prepare DE quotas', assigneeId: users.VIEWER.id, dueAt: '2026-01-05', priority: 'HIGH' }).expect(201)).body;
    expect(a).toMatchObject({ status: 'OPEN', overdue: true, assignee: { id: users.VIEWER.id }, source: 'manual' });
    const b = (await pm.post('/tasks', { title: 'Launch DE', blockedById: a.id }).expect(201)).body;
    expect(b).toMatchObject({ blocked: true, blockedBy: { title: 'Prepare DE quotas' } });
    await pm.patch(`/tasks/${a.id}`, { blockedById: b.id }).expect(400); // would wait for each other
    await viewer.patch(`/tasks/${b.id}`, { status: 'DONE' }).expect(403); // not assigned to them
    await viewer.patch(`/tasks/${a.id}`, { priority: 'LOW' }).expect(403);
    const done = (await viewer.patch(`/tasks/${a.id}`, { status: 'DONE' }).expect(200)).body;
    expect(done).toMatchObject({ status: 'DONE', overdue: false });
    expect(done.completedAt).toBeTruthy();
    expect((await pm.get(`/tasks/${b.id}`).expect(200)).body.blocked).toBe(false);
    expect((await pm.get('/tasks').expect(200)).body.map((t: { title: string }) => t.title)).toEqual(['Launch DE']);
    expect((await pm.get('/tasks?status=all').expect(200)).body).toHaveLength(2);
    expect((await other.get('/tasks?status=all').expect(200)).body).toEqual([]);
    await other.get(`/tasks/${a.id}`).expect(404);
  });

  it('reminders and overdue tasks show in the assignee’s notifications', async () => {
    await pm.post('/tasks', { title: 'Chase vendor invoice', assigneeId: users.VIEWER.id, remindAt: '2026-01-01' }).expect(201);
    await pm.post('/tasks', { title: 'Later', assigneeId: users.VIEWER.id, remindAt: '2099-01-01' }).expect(201);
    const items = (await viewer.get('/insights').expect(200)).body.items.map((i: { title: string }) => i.title);
    expect(items).toContain('Reminder: Chase vendor invoice');
    expect(items).not.toContain('Reminder: Later');
    expect((await pm.get('/insights').expect(200)).body.items.map((i: { title: string }) => i.title)).not.toContain('Reminder: Chase vendor invoice');
  });
});
