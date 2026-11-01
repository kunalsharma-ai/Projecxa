/** Local stand-in for a vendor's server-to-server callback endpoint. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  console.log('[mock vendor callback]', Object.fromEntries(url.searchParams), req.headers.get('x-idempotency-key'));
  return Response.json({ ok: true });
}
