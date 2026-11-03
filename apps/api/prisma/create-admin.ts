/**
 * Creates an organisation and its first admin on a fresh server. No demo data.
 *
 *   pnpm create-admin --org-name "Frequent Research" --email you@company.com --name "Your Name"
 *
 * Options: --slug <org-slug> (default: from the name). The password is asked for
 * (hidden), or read from the ADMIN_PASSWORD environment variable when not run in a terminal.
 *
 * The first organisation on a server becomes the server owner: its admins set up
 * sign-in, Xero/QuickBooks and Tally for the whole server (docs/INTEGRATIONS.md).
 * Running it again with an existing slug adds another admin to that organisation.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { firstAdminProblems, parseFlags, slugify } from '../src/auth/first-admin';

function askHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    process.stdout.write(question);
    let value = '';
    stdin.setRawMode?.(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (ch: string) => {
      for (const c of ch) {
        if (c === '\r' || c === '\n' || c === '\u0004') {
          stdin.setRawMode?.(false);
          stdin.pause();
          stdin.off('data', onData);
          process.stdout.write('\n');
          return resolve(value);
        }
        if (c === '\u0003') process.exit(130);
        if (c === '\u007f' || c === '\b') value = value.slice(0, -1);
        else value += c;
      }
    };
    stdin.on('data', onData);
  });
}

async function password(): Promise<string> {
  if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD;
  if (!process.stdin.isTTY) {
    console.error('Set ADMIN_PASSWORD, or run this in a terminal to type the password.');
    process.exit(1);
  }
  const a = await askHidden('Password for the admin (at least 10 characters): ');
  const b = await askHidden('Type it again: ');
  if (a !== b) {
    console.error('The two passwords are different.');
    process.exit(1);
  }
  return a;
}

async function main() {
  const f = parseFlags(process.argv.slice(2));
  if (f.help) {
    console.log('Usage: pnpm create-admin --org-name "Company" --email admin@company.com --name "Full Name" [--slug company]');
    return;
  }
  const orgName = (f['org-name'] ?? '').trim();
  const email = (f.email ?? '').trim().toLowerCase();
  const input = { orgName, slug: (f.slug ?? slugify(orgName)).trim(), email, name: (f.name ?? '').trim(), password: '' };
  const early = firstAdminProblems({ ...input, password: 'x'.repeat(10) + '!' });
  if (early.length) {
    early.forEach((p) => console.error(`- ${p}`));
    console.error('\nUsage: pnpm create-admin --org-name "Company" --email admin@company.com --name "Full Name" [--slug company]');
    process.exit(1);
  }
  input.password = await password();
  const problems = firstAdminProblems(input);
  if (problems.length) {
    problems.forEach((p) => console.error(`- ${p}`));
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const existing = await prisma.organization.findUnique({ where: { slug: input.slug } });
    const firstOnServer = (await prisma.organization.count()) === 0;
    const hash = await bcrypt.hash(input.password, 10);
    const result = await prisma.$transaction(async (tx) => {
      const org = existing ?? (await tx.organization.create({ data: { name: input.orgName, slug: input.slug, platformOwner: firstOnServer } }));
      const clash = await tx.user.findFirst({ where: { organizationId: org.id, email: input.email } });
      if (clash) throw new Error(`${input.email} already has an account in "${org.name}". Use "Forgot password" on the sign-in page instead.`);
      const user = await tx.user.create({
        data: { organizationId: org.id, email: input.email, name: input.name, passwordHash: hash, passwordSetAt: new Date(), role: 'ADMIN' },
      });
      await tx.auditEvent.create({
        data: { organizationId: org.id, actorId: user.id, action: existing ? 'user.admin_created_cli' : 'organization.created_cli', entityType: 'User', entityId: user.id, detail: { email: input.email, organization: org.slug } },
      });
      return { org, user };
    });
    console.log(existing ? `Added admin ${result.user.email} to "${result.org.name}" (${result.org.slug}).` : `Created "${result.org.name}" (${result.org.slug}) with admin ${result.user.email}.`);
    if (!existing && firstOnServer) console.log('This is the server owner organisation: its admins set up sign-in and accounting apps for the server.');
    console.log('Sign in on the web app with that email and password. Next: Settings → Integrations, then Settings → Team.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
