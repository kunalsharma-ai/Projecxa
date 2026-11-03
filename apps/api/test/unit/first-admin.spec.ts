import { firstAdminProblems, parseFlags, passwordProblem, slugify } from '../../src/auth/first-admin';

describe('create-admin command rules', () => {
  const ok = { orgName: 'Frequent Research', slug: 'frequent-research', email: 'kunal@frequentresearch.com', name: 'Kunal', password: 'correct horse battery' };

  it('reads --flag value and --flag=value', () => {
    expect(parseFlags(['--org-name', 'Acme Ltd', '--email=a@b.co', '--help'])).toEqual({ 'org-name': 'Acme Ltd', email: 'a@b.co', help: 'true' });
  });

  it('makes a slug from the company name', () => {
    expect(slugify('Frequent Research Pvt. Ltd.')).toBe('frequent-research-pvt-ltd');
    expect(slugify('  Ünïcode & Co ')).toBe('unicode-co');
  });

  it('accepts a good input', () => {
    expect(firstAdminProblems(ok)).toEqual([]);
  });

  it('rejects demo emails, bad slugs and weak passwords', () => {
    expect(firstAdminProblems({ ...ok, email: 'admin@projexa.local' }).join()).toMatch(/real address/);
    expect(firstAdminProblems({ ...ok, slug: 'Bad Slug' }).join()).toMatch(/--slug/);
    expect(passwordProblem('short', ok.email)).toMatch(/10 characters/);
    expect(passwordProblem('kunal-is-my-password', ok.email)).toMatch(/email/);
    expect(firstAdminProblems({ ...ok, orgName: ' ', name: '' })).toHaveLength(2);
  });
});
