import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { api, createApp, login, makeOrg, resetDb } from './helpers';

describe('Project list sorting for the data grid (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let pm: ReturnType<typeof api>;

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await resetDb(prisma);
    const a = await makeOrg(prisma, 'sort-a');
    pm = api(app, await login(app, a.users.PROJECT_MANAGER.email));
    const zed = (await pm.post('/clients', { name: 'Zed Research', code: 'ZR' }).expect(201)).body.id;
    const abc = (await pm.post('/clients', { name: 'Abc Insights', code: 'AI' }).expect(201)).body.id;
    const make = (name: string, clientId: string) =>
      pm
        .post('/projects', {
          name,
          category: 'B2C',
          clientId,
          defaults: { language: 'en', loiMinutes: 10, irPercent: 50, cpi: 5, targetCompletes: 10, liveSurveyUrl: 'https://client.example.com/s?rid={session_token}' },
          countries: [{ countryCode: 'US' }],
        })
        .expect(201);
    await make('Bravo study', zed);
    await make('alpha study', abc);
    await make('Charlie study', zed);
  });

  afterAll(async () => {
    await app.close();
  });

  const names = async (q: string) => ((await pm.get(`/projects?${q}`).expect(200)).body.items as { name: string }[]).map((p) => p.name);

  it('sorts by name, client and creation, in both directions', async () => {
    expect(await names('')).toEqual(['Charlie study', 'alpha study', 'Bravo study']);
    expect(await names('sort=created&dir=asc')).toEqual(['Bravo study', 'alpha study', 'Charlie study']);
    // Names sort the way people read them, ignoring case.
    expect(await names('sort=name&dir=asc')).toEqual(['alpha study', 'Bravo study', 'Charlie study']);
    expect(await names('sort=name&dir=desc')).toEqual(['Charlie study', 'Bravo study', 'alpha study']);
    expect(await names('sort=name&dir=asc&page=2&pageSize=2')).toEqual(['Charlie study']);
    expect(await names('sort=name&dir=asc&q=study&status=DRAFT')).toHaveLength(3);
    // Same client: newest first breaks the tie.
    expect(await names('sort=client&dir=asc')).toEqual(['alpha study', 'Charlie study', 'Bravo study']);
    expect(await names('sort=client&dir=asc&page=2&pageSize=2')).toEqual(['Bravo study']);
    await pm.get('/projects?sort=revenue').expect(400);
    await pm.get('/projects?sort=name&dir=sideways').expect(400);
  });
});
