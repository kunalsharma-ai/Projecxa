'use client';
import clsx from 'clsx';
import { Check } from 'lucide-react';

/** The same rules the API checks, shown while typing. */
export function passwordProblems(p: string, confirm: string) {
  return [
    { ok: p.length >= 10, text: 'At least 10 characters' },
    { ok: p.length > 0 && !/^\d+$/.test(p), text: 'Not only digits' },
    { ok: p.length > 0 && p === confirm, text: 'Both entries match' },
  ];
}

export function PasswordRules({ password, confirm }: { password: string; confirm: string }) {
  return (
    <ul className="space-y-1 text-xs">
      {passwordProblems(password, confirm).map((r) => (
        <li key={r.text} className={clsx('flex items-center gap-1.5', r.ok ? 'text-ok' : 'text-muted')}><Check className={clsx('h-3.5 w-3.5', !r.ok && 'opacity-30')} />{r.text}</li>
      ))}
    </ul>
  );
}
