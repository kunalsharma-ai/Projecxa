/**
 * Masked contact details for project pages: enough to recognise the person and the company
 * (the email domain stays), without showing the full address on screen or in screenshots.
 */
export function maskEmail(email: string | null | undefined): string {
  const e = (email ?? '').trim();
  const at = e.lastIndexOf('@');
  if (at < 1) return '•'.repeat(Math.min(e.length, 8));
  const user = e.slice(0, at);
  const domain = e.slice(at + 1);
  const hidden = user.length <= 1 ? '•' : user.length === 2 ? `${user[0]}•` : `${user[0]}${'•'.repeat(Math.min(user.length - 2, 6))}${user[user.length - 1]}`;
  return `${hidden}@${domain}`;
}

/** Keeps the country code and the last four digits. */
export function maskPhone(phone: string | null | undefined): string {
  const p = (phone ?? '').trim();
  if (!p) return '';
  const digits = p.replace(/\D/g, '').length;
  let seen = 0;
  const cc = /^\+\d{1,3}/.exec(p)?.[0] ?? '';
  return cc + p.slice(cc.length).replace(/\d/g, (d) => (++seen > digits - cc.replace('+', '').length - 4 ? d : '•'));
}

/** "aceresearch.com" from an email, for the company line. */
export const emailDomain = (email: string | null | undefined) => {
  const e = (email ?? '').trim();
  const at = e.lastIndexOf('@');
  return at > 0 ? e.slice(at + 1).toLowerCase() : null;
};
