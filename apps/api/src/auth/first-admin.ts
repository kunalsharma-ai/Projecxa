/**
 * Rules for `pnpm create-admin` (prisma/create-admin.ts): the command that sets up
 * an organisation and its first admin on a fresh server, without demo data.
 * Kept free of database code so it can be unit-tested.
 */

export interface FirstAdminInput {
  orgName: string;
  slug: string;
  email: string;
  name: string;
  password: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/;

/** `--org-name "Acme"` / `--org-name=Acme` style flags into a map. */
export function parseFlags(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    if (eq > 0) out[a.slice(2, eq)] = a.slice(eq + 1);
    else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) out[a.slice(2)] = argv[++i];
    else out[a.slice(2)] = 'true';
  }
  return out;
}

/** "Frequent Research Pvt. Ltd." -> "frequent-research-pvt-ltd" */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
}

/** Same rules as setting a password from an invite or reset link (auth/password.service.ts). */
export function passwordProblem(password: string, email: string): string | null {
  if (password.length < 10) return 'Use at least 10 characters';
  if (password.length > 200) return 'Use at most 200 characters';
  const local = email.split('@')[0].toLowerCase();
  if (local.length >= 4 && password.toLowerCase().includes(local)) return 'Do not use your email in the password';
  return null;
}

/** Every problem with the input, in the order a person would fix them. Empty when it is fine. */
export function firstAdminProblems(i: FirstAdminInput): string[] {
  const p: string[] = [];
  if (!i.orgName.trim()) p.push('--org-name is required (your company name, shown in the app)');
  if (!SLUG.test(i.slug)) p.push('--slug must be 1-48 lowercase letters, digits or dashes, e.g. frequent-research');
  if (!EMAIL.test(i.email)) p.push('--email must be a valid email address');
  if (i.email.toLowerCase().endsWith('@projexa.local')) p.push('--email must be a real address, not a demo @projexa.local one');
  if (!i.name.trim()) p.push('--name is required (the admin\'s full name)');
  const pw = passwordProblem(i.password, i.email);
  if (pw) p.push(`Password: ${pw}`);
  return p;
}
