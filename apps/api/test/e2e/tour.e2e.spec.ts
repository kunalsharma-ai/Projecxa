import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '../../src/prisma/client';
import { TOUR_VERSION } from '../../src/auth/tour';
import { api, createApp, login, makeOrg, resetDb } from './helpers';

describe('Product tour (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let pm: ReturnType<typeof api>;
  let viewer: ReturnType<typeof api>;
  let pmId: string;

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await resetDb(prisma);
    const a = await makeOrg(prisma, 'tour');
    pmId = a.users.PROJECT_MANAGER.id;
    pm = api(app, await login(app, a.users.PROJECT_MANAGER.email));
    viewer = api(app, await login(app, a.users.VIEWER.email));
  });
  afterAll(async () => {
    await app.close();
  });

  it('shows to someone who has not seen it', async () => {
    expect((await pm.get('/auth/me').expect(200)).body.tour).toEqual({ version: TOUR_VERSION, show: true, outcome: null, at: null });
  });

  it('remembers skipping, per user', async () => {
    const r = (await pm.post('/auth/me/tour', { outcome: 'skipped' }).expect(200)).body;
    expect(r).toMatchObject({ show: false, outcome: 'skipped' });
    expect((await pm.get('/auth/me').expect(200)).body.tour).toMatchObject({ show: false, outcome: 'skipped' });
    expect((await viewer.get('/auth/me').expect(200)).body.tour.show).toBe(true);
  });

  it('remembers finishing, and survives a reset of the look', async () => {
    await viewer.post('/auth/me/tour', { outcome: 'completed' }).expect(200);
    await viewer.post('/auth/me/preferences/reset').expect(200);
    expect((await viewer.get('/auth/me').expect(200)).body.tour).toMatchObject({ show: false, outcome: 'completed' });
  });

  it('can be asked for again', async () => {
    expect((await pm.post('/auth/me/tour', { outcome: 'reset' }).expect(200)).body).toEqual({ version: TOUR_VERSION, show: true, outcome: null, at: null });
  });

  it('shows again when a newer tour is released', async () => {
    await prisma.user.update({ where: { id: pmId }, data: { tourVersion: TOUR_VERSION - 1, tourOutcome: 'completed', tourAt: new Date() } });
    expect((await pm.get('/auth/me').expect(200)).body.tour).toMatchObject({ show: true, outcome: null });
  });

  it('rejects bad input', async () => {
    await pm.post('/auth/me/tour', { outcome: 'done' }).expect(400);
    await pm.post('/auth/me/tour', { outcome: 'skipped', tourVersion: 99 }).expect(400);
    await api(app, '').post('/auth/me/tour', { outcome: 'skipped' }).expect(401);
  });
});
