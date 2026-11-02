/**
 * Local stand-in for a client's routing endpoint (API redirect destinations, docs/REDIRECT_DESTINATIONS.md).
 * Sends German completes to one thank-you page and everyone else to the generic vendor page.
 */
export async function POST(req: Request) {
  const p = (await req.json().catch(() => ({}))) as { status?: string; respondent_uid?: string; vendor_id?: string; country_code?: string; test?: boolean };
  const base = new URL(req.url).origin;
  const state = (p.status ?? 'complete').toLowerCase();
  const target = p.country_code === 'DE' ? `${base}/mock/end?state=${state}&market=de` : `${base}/mock/vendor/${encodeURIComponent(p.vendor_id ?? 'generic')}?state=${state}`;
  const url = new URL(target);
  if (p.respondent_uid) url.searchParams.set('uid', p.respondent_uid);
  if (p.test) url.searchParams.set('test', '1');
  return Response.json({ url: url.toString() });
}
