import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { PrismaService } from '../../src/prisma/prisma.service';

export async function createApp() {
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = configureApp(mod.createNestApplication({ rawBody: true }));
  await app.init();
  return { app, prisma: app.get(PrismaService) as PrismaClient, mod };
}

export async function resetDb(prisma: PrismaClient) {
  await prisma.$executeRawUnsafe('TRUNCATE "Organization" CASCADE');
}

export const PASSWORD = 'correct-horse-battery';

export async function makeOrg(prisma: PrismaClient, slug: string, domains = ['client.example.com', 'vendor.example.com']) {
  const org = await prisma.organization.create({ data: { name: slug, slug, redirectAllowedDomains: domains } });
  const hash = await bcrypt.hash(PASSWORD, 4);
  const users: Record<string, { id: string; email: string }> = {};
  for (const role of ['ADMIN', 'PROJECT_MANAGER', 'VIEWER'] as Role[]) {
    const u = await prisma.user.create({
      data: { organizationId: org.id, email: `${role.toLowerCase()}@${slug}.test`, name: role, role, passwordHash: hash, passwordSetAt: new Date() },
    });
    users[role] = u;
  }
  return { org, users };
}

export async function login(app: INestApplication, email: string): Promise<string> {
  const res = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email, password: PASSWORD }).expect(200);
  return res.body.token;
}

export function api(app: INestApplication, token: string) {
  const s = () => request(app.getHttpServer());
  const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);
  return {
    get: (p: string) => auth(s().get(`/api/v1${p}`)),
    post: (p: string, body?: object) => auth(s().post(`/api/v1${p}`)).send(body ?? {}),
    patch: (p: string, body?: object) => auth(s().patch(`/api/v1${p}`)).send(body ?? {}),
    delete: (p: string) => auth(s().delete(`/api/v1${p}`)),
    put: (p: string, body?: object) => (body ? auth(s().put(`/api/v1${p}`)).send(body) : auth(s().put(`/api/v1${p}`))),
  };
}

export function tokenFrom(location: string): string {
  return new URL(location).searchParams.get('token')!;
}
