# Public API and webhooks

Milestone 12 lets other systems connect to SampTrek: a data warehouse, a BI dashboard, a client's
own tracker, or an automation tool. There are two parts:

1. A **REST API** that other systems call with an **API key**.
2. **Event webhooks** that SampTrek sends to your URL when something happens.

Both are managed by admins in **Settings → API and webhooks** (`/settings/developers`).

## API keys

| | |
|---|---|
| Format | `pjx_` followed by 32 random URL-safe characters |
| Storage | Only the SHA-256 hash and the first 12 characters (shown in lists) are kept. The key is shown once, when it is created. |
| Who | Admins create and revoke keys. |
| Expiry | Never, 30 days, 90 days or 1 year. Expired and revoked keys get `401`. |
| Rate limit | 120 requests per minute per key (`PUBLIC_API_RATE_LIMIT`). Responses carry `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`; over the limit you get `429` with `Retry-After`. The count is kept per API process; move it to Redis when running several API instances. |
| Writes | A key with `projects:write` acts as the admin who created it. Changes appear in the audit trail under that person, and the key stops writing if that person is deactivated or is no longer an admin or project manager. |

Send the key either way:

```
Authorization: Bearer pjx_...
X-API-Key: pjx_...
```

A staff sign-in token does not work on the public API, and an API key does not work on the
staff API.

### Permissions

| Scope | Allows |
|---|---|
| `projects:read` | Projects, markets, vendor links and progress |
| `projects:write` | Change project, market and vendor link status and targets |
| `sessions:read` | Respondent sessions and their outcomes (live traffic only, never test sessions) |
| `quotas:read` | Quota cells and their fill |
| `finance:read` | Client invoices and vendor bills |

A call without the needed scope gets `403` with the scope's name in the message.

## Endpoints

Base URL: `{PUBLIC_BASE_URL}/api/v1/public`. Everything is limited to the key's organization.
`{ref}` is a project code (`PRX10001`, any case) or a project id. The full description is
served without a key at `/api/v1/public/openapi.json` (OpenAPI 3.0), so Postman, Insomnia or a
code generator can import it.

| Method | Path | Scope | |
|---|---|---|---|
| GET | `/me` | any | The key's name, prefix, scopes, expiry and organization |
| GET | `/projects?status=&updatedSince=` | projects:read | Newest first, with totals and market list |
| GET | `/projects/{ref}` | projects:read | Markets, vendor links (id, vendor, status, CPI, target, completes) and session counts per status |
| PATCH | `/projects/{ref}` | projects:write | `{ status?, fieldStartAt?, fieldEndAt? }`. Going live runs the same checks as the app |
| PATCH | `/projects/{ref}/markets/{countryCode}` | projects:write | `{ status?, targetCompletes? }` |
| PATCH | `/projects/{ref}/markets/{countryCode}/vendor-links/{linkId}` | projects:write | `{ status?: ACTIVE \| PAUSED \| CLOSED, targetCompletes? }` |
| GET | `/projects/{ref}/sessions?status=&outcomeSince=` | sessions:read | Newest first; status, approval, vendor respondent id, device, revenue, payout |
| GET | `/projects/{ref}/quotas` | quotas:read | Cells per market with conditions, target, completes and open/closed |
| GET | `/invoices?status=&updatedSince=` | finance:read | Client invoices with lines, tax and totals |
| GET | `/bills?status=&updatedSince=` | finance:read | Vendor bills with lines, tax, totals and references |

Vendor entry links are never returned: they are what a vendor sends respondents to.

### Paging

List endpoints take `limit` (1–200, default 50) and return:

```json
{ "data": [ ... ], "nextCursor": "cmv..." }
```

Pass `nextCursor` back as `cursor` for the next page. It is `null` on the last page. For a
regular sync, combine paging with `updatedSince` (projects, invoices, bills) or `outcomeSince`
(sessions).

### Errors

`400` validation failed (the body lists the fields), `401` no key or a bad, revoked or expired
key, `403` missing scope or the key's creator can no longer make changes, `404` not in your
organization, `429` rate limit.

## Event webhooks

An admin adds an HTTPS endpoint (plain `http://` only outside production), picks events and
gets a signing secret (`whsec_...`, shown once). Up to 10 endpoints per organization.

| Event | When | `data` |
|---|---|---|
| `session.completed` | A live respondent completes, after quota checks (overquota completes do not fire) | `session`, `project`, `market`, `vendor` |
| `project.status_changed` | A project's status changes, in the app or through the API | `project`, `from`, `to`, `changedBy` |
| `alert.opened` | The fieldwork monitor opens a new alert | `alert` (rule, severity, title, detail, autopilot action, project) |
| `invoice.status_changed` | A client invoice is sent, paid or voided | `invoice`, `from`, `to` |
| `bill.status_changed` | A vendor bill is approved, paid or voided | `bill`, `from`, `to` |

Each delivery is a POST with this body:

```json
{ "id": "evt_...", "event": "project.status_changed", "createdAt": "2026-11-01T20:15:00.000Z", "data": { ... } }
```

and these headers:

| Header | |
|---|---|
| `X-Projexa-Event` | The event name |
| `X-Projexa-Delivery` | Delivery id (differs per endpoint and send) |
| `X-Projexa-Timestamp` | Unix seconds when it was sent |
| `X-Projexa-Signature` | `sha256=` + HMAC-SHA256 of `{timestamp}.{raw body}` with your secret (same scheme as the alert webhook) |

The event `id` is the same for every endpoint and every retry, so use it to ignore duplicates.

### Checking the signature (Node)

```js
const crypto = require('crypto');
function verify(secret, req, rawBody) {
  const ts = req.headers['x-projexa-timestamp'];
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false; // 5 minute window
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(`${ts}.${rawBody}`).digest('hex');
  const got = String(req.headers['x-projexa-signature'] ?? '');
  return got.length === expected.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}
```

### Delivery and retries

- Events are written to a delivery table first, so an endpoint that is down never slows the
  respondent or the person who made the change. A background worker (the same switch as vendor
  callbacks, `CALLBACK_WORKER_ENABLED`) sends them every few seconds. Rows are claimed with a
  guarded update, so two workers never send the same delivery.
- Any `2xx` is success. A `4xx` other than `408` and `429` is permanent and is not retried.
  Anything else (timeouts after 10 seconds, `5xx`, connection errors) is retried with backoff:
  30 s, 1 min, 2 min … capped at 1 hour, with jitter, up to 12 tries (about six hours).
- Redirects are not followed.
- Failed and given-up deliveries can be sent again from the delivery log (same event id). An
  endpoint that is switched off cancels what is still waiting.
- **Send test** posts a signed `ping` event straight away and shows the HTTP status.
- **New secret** replaces the signing secret immediately.

## Code

- `apps/api/src/public-api/api-keys.ts`: scopes, key generation, admin endpoints (`/api/v1/api-keys`).
- `apps/api/src/public-api/api-key.guard.ts`: key check, scope check, rate limit.
- `apps/api/src/public-api/public-api.controller.ts`: the public endpoints. `openapi.ts`: the description.
- `apps/api/src/webhooks/`: events, queueing (`emit`), the worker and admin endpoints (`/api/v1/webhooks`).
- Tests: `test/e2e/public-api.e2e.spec.ts`, `test/unit/public-api.spec.ts`.
