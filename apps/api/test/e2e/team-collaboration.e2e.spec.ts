import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { MailService } from '../../src/mail/mail.service';
import { activityKind, mentions } from '../../src/collaboration/collaboration';
import { api, createApp, login, makeOrg, resetDb } from './helpers';

describe('Team comments, @mentions, handovers and activity (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let admin: ReturnType<typeof api>;
  let pm: ReturnType<typeof api>;
  let viewer: ReturnType<typeof api>;
  let otherOrg: ReturnType<typeof api>;
  let portal: ReturnType<typeof api>;
  let users: Record<string, { id: string; email: string }>;
  let projectId: string;
  const sent: { to: string[]; subject: string; text: string }[] = [];

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await resetDb(prisma);
    const a = await makeOrg(prisma, 'team-a');
    const b = await makeOrg(prisma, 'team-b');
    users = a.users;
    await prisma.user.update({ where: { id: users.ADMIN.id }, data: { name: 'Priya Shah' } });
    await prisma.user.update({ where: { id: users.PROJECT_MANAGER.id }, data: { name: 'Arjun Rao' } });
    await prisma.user.update({ where: { id: users.VIEWER.id }, data: { name: 'Meera Das' } });
    admin = api(app, await login(app, users.ADMIN.email));
    pm = api(app, await login(app, users.PROJECT_MANAGER.email));
    viewer = api(app, await login(app, users.VIEWER.email));
    otherOrg = api(app, await login(app, b.users.PROJECT_MANAGER.email));
    app.get(MailService).transport = async (_from, m) => {
      sent.push({ to: m.to, subject: m.subject, text: m.text });
      return { messageId: 'x' };
    };
    const clientId = (await pm.post('/clients', { name: 'Acme', code: 'TC1' }).expect(201)).body.id;
    await pm.post('/portal-users', { kind: 'client', partyId: clientId, name: 'Client user', email: 'c@team.test', password: 'portal-password-123' }).expect(201);
    const tok = (await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email: 'c@team.test', password: 'portal-password-123' }).expect(200)).body.token;
    portal = api(app, tok);
    projectId = (
      await pm
        .post('/projects', {
          name: 'Team study',
          category: 'B2B',
          clientId,
          projectManagerId: users.PROJECT_MANAGER.id,
          defaults: { language: 'en', loiMinutes: 10, irPercent: 50, cpi: 9, targetCompletes: 10, liveSurveyUrl: 'https://client.example.com/s?rid={session_token}' },
          countries: [{ countryCode: 'US' }],
        })
        .expect(201)
    ).body.id;
  });
  afterAll(() => app.close());

  it('finds @Name mentions only as whole names', () => {
    expect(mentions('Thanks @Meera Das, can you check?', 'Meera Das')).toBe(true);
    expect(mentions('@meera das please', 'Meera Das')).toBe(true);
    expect(mentions('mail meera@x.com', 'meera')).toBe(false);
    expect(mentions('@Meera Dasgupta', 'Meera Das')).toBe(false);
    expect(activityKind('comment.create')).toBe('comments');
    expect(activityKind('autopilot.pause_link')).toBe('fieldwork');
    expect(activityKind('project.update')).toBe('changes');
  });

  it('comments with @mentions notify by bell and email; portals and other orgs see nothing', async () => {
    const people = (await viewer.get(`/projects/${projectId}/mentionable`).expect(200)).body;
    expect(people.map((p: { name: string }) => p.name)).toEqual(['Arjun Rao', 'Meera Das', 'Priya Shah']);
    sent.length = 0;
    const c = (await pm.post(`/projects/${projectId}/comments`, { body: '@Meera Das can you QA the DE link? cc @Priya Shah', mentionIds: [users.VIEWER.id] }).expect(201)).body;
    expect(c.mentions.map((m: { name: string }) => m.name).sort()).toEqual(['Meera Das', 'Priya Shah']);
    expect(c).toMatchObject({ mine: true, author: { name: 'Arjun Rao' } });
    // A picked id whose @Name is no longer in the text is not a mention.
    const c2 = (await pm.post(`/projects/${projectId}/comments`, { body: 'No mention here', mentionIds: [users.VIEWER.id] }).expect(201)).body;
    expect(c2.mentions).toEqual([]);
    expect(sent.map((m) => m.to[0]).sort()).toEqual([users.ADMIN.email, users.VIEWER.email]);
    expect(sent[0].subject).toContain('Arjun Rao mentioned you on');
    expect(sent[0].text).toContain(`?tab=team#comment-${c.id}`);

    const bell = (await viewer.get('/insights').expect(200)).body;
    const item = bell.items.find((i: { id: string }) => i.id === `mention-${c.id}`);
    expect(item).toMatchObject({ severity: 'warn', read: false, href: `/projects/${projectId}?tab=team#comment-${c.id}` });
    expect(bell.unread).toBeGreaterThan(0);
    await viewer.post('/insights/read', { items: [{ id: item.id, title: item.title }] }).expect(201);
    expect((await viewer.get('/insights').expect(200)).body.items.find((i: { id: string }) => i.id === item.id).read).toBe(true);
    // The author is not notified about their own comment.
    expect((await pm.get('/insights').expect(200)).body.items.find((i: { id: string }) => i.id === `mention-${c.id}`)).toBeUndefined();

    // Viewers can comment too; only the writer edits, the writer or an admin deletes.
    const v = (await viewer.post(`/projects/${projectId}/comments`, { body: 'Done, all good.' }).expect(201)).body;
    await pm.patch(`/projects/${projectId}/comments/${v.id}`, { body: 'Hijack' }).expect(403);
    sent.length = 0;
    const edited = (await viewer.patch(`/projects/${projectId}/comments/${v.id}`, { body: 'Done, all good. @Arjun Rao' }).expect(200)).body;
    expect(edited.editedAt).toBeTruthy();
    expect(sent.map((m) => m.to[0])).toEqual([users.PROJECT_MANAGER.email]);
    await pm.delete(`/projects/${projectId}/comments/${v.id}`).expect(403);
    await admin.delete(`/projects/${projectId}/comments/${v.id}`).expect(200);
    expect((await pm.get(`/projects/${projectId}/comments`).expect(200)).body).toHaveLength(2);

    await otherOrg.get(`/projects/${projectId}/comments`).expect(404);
    await otherOrg.post(`/projects/${projectId}/comments`, { body: 'x' }).expect(404);
    await portal.get(`/projects/${projectId}/comments`).expect(403);
    await pm.post(`/projects/${projectId}/comments`, { body: '   ' }).expect(400);
  });

  it('hands a project over with a checklist; the receiver becomes project manager on accept', async () => {
    await viewer.post(`/projects/${projectId}/handovers`, { toUserId: users.ADMIN.id }).expect(403);
    await pm.post(`/projects/${projectId}/handovers`, { toUserId: users.VIEWER.id }).expect(400); // viewers cannot run a project
    await pm.post(`/projects/${projectId}/handovers`, { toUserId: users.PROJECT_MANAGER.id }).expect(400);
    sent.length = 0;
    const h = (await pm.post(`/projects/${projectId}/handovers`, { toUserId: users.ADMIN.id, note: 'Client prefers WhatsApp', skip: ['finance'], extraItems: ['Share the weekly report contacts'] }).expect(201)).body;
    expect(h).toMatchObject({ status: 'OPEN', total: 7, done: 0, from: { name: 'Arjun Rao' }, to: { name: 'Priya Shah' }, canTick: true, canAccept: false, canCancel: true });
    expect(h.items.map((i: { key: string }) => i.key)).not.toContain('finance');
    expect(h.items.at(-1)).toMatchObject({ key: 'extra-1', label: 'Share the weekly report contacts' });
    expect(sent.map((m) => m.to[0])).toEqual([users.ADMIN.email]);
    await pm.post(`/projects/${projectId}/handovers`, { toUserId: users.ADMIN.id }).expect(400); // one open at a time

    const bell = (await admin.get('/insights').expect(200)).body.items.find((i: { id: string }) => i.id === `handover-${h.id}`);
    expect(bell).toMatchObject({ severity: 'warn', href: `/projects/${projectId}?tab=team` });

    await viewer.patch(`/projects/${projectId}/handovers/${h.id}/items/links`, { done: true }).expect(403);
    await pm.patch(`/projects/${projectId}/handovers/${h.id}/items/nope`, { done: true }).expect(404);
    const t = (await pm.patch(`/projects/${projectId}/handovers/${h.id}/items/links`, { done: true }).expect(200)).body;
    expect(t.items[0]).toMatchObject({ done: true, doneBy: 'Arjun Rao' });
    await pm.post(`/projects/${projectId}/handovers/${h.id}/accept`).expect(403);
    const early = await admin.post(`/projects/${projectId}/handovers/${h.id}/accept`).expect(400);
    expect(early.body.message).toContain('6 left');
    for (const i of h.items.slice(1)) await admin.patch(`/projects/${projectId}/handovers/${h.id}/items/${i.key}`, { done: true }).expect(200);
    sent.length = 0;
    const done = (await admin.post(`/projects/${projectId}/handovers/${h.id}/accept`).expect(201)).body;
    expect(done).toMatchObject({ status: 'ACCEPTED', done: 7, canTick: false });
    expect((await prisma.project.findUniqueOrThrow({ where: { id: projectId } })).projectManagerId).toBe(users.ADMIN.id);
    expect(sent.map((m) => m.to[0])).toEqual([users.PROJECT_MANAGER.email]);
    await admin.post(`/projects/${projectId}/handovers/${h.id}/cancel`).expect(400);
    expect((await admin.get('/insights').expect(200)).body.items.find((i: { id: string }) => i.id === `handover-${h.id}`)).toBeUndefined();

    // A new handover can start once the last one is finished, and the sender can cancel it.
    const h2 = (await admin.post(`/projects/${projectId}/handovers`, { toUserId: users.PROJECT_MANAGER.id, makeManager: false }).expect(201)).body;
    await viewer.post(`/projects/${projectId}/handovers/${h2.id}/cancel`).expect(403);
    expect((await admin.post(`/projects/${projectId}/handovers/${h2.id}/cancel`).expect(201)).body.status).toBe('CANCELLED');
    const list = (await viewer.get(`/projects/${projectId}/handovers`).expect(200)).body;
    expect(list.handovers.map((x: { status: string }) => x.status)).toEqual(['CANCELLED', 'ACCEPTED']);
    expect(list.defaults).toHaveLength(7);
  });

  it('shows the project activity feed with filters and paging', async () => {
    const all = (await viewer.get(`/projects/${projectId}/activity`).expect(200)).body;
    const actions = all.items.map((i: { action: string }) => i.action);
    expect(actions).toEqual(expect.arrayContaining(['project.create', 'comment.create', 'comment.edit', 'comment.delete', 'handover.start', 'handover.tick', 'handover.accept', 'handover.cancel', 'project.update']));
    const pmChange = all.items.find((i: { action: string }) => i.action === 'project.update');
    expect(pmChange).toMatchObject({ actor: 'Priya Shah', kind: 'changes', summary: 'Project manager → Priya Shah' });
    const comment = all.items.find((i: { action: string }) => i.action === 'comment.create');
    expect(comment).toMatchObject({ label: 'commented', kind: 'comments' });
    const onlyHandovers = (await viewer.get(`/projects/${projectId}/activity?kind=handovers`).expect(200)).body.items;
    expect(onlyHandovers.length).toBeGreaterThan(0);
    expect(onlyHandovers.every((i: { kind: string }) => i.kind === 'handovers')).toBe(true);
    const page = (await viewer.get(`/projects/${projectId}/activity?limit=3`).expect(200)).body;
    expect(page.items).toHaveLength(3);
    expect(page.next).toBeTruthy();
    const next = (await viewer.get(`/projects/${projectId}/activity?limit=3&before=${encodeURIComponent(page.next)}`).expect(200)).body;
    expect(next.items[0].id).not.toBe(page.items[0].id);
    await otherOrg.get(`/projects/${projectId}/activity`).expect(404);
  });
});
