# SampBidx → SampTrek: won bid intake

> **Name change (November 2026):** the bidding tool called **Bidzo** is now **SampBidx**. Everything
> people see says SampBidx. The webhook contract is unchanged: SampBidx still has to send the signed
> `bid.won` webhook below before won bids show up in SampTrek. Old names keep working, see
> [Names kept from Bidzo](#names-kept-from-bidzo).

When a bid is marked **won** in SampBidx, SampBidx sends one signed webhook to SampTrek. The bid then appears in SampTrek under **Won bids → Waiting for setup**, where a PM clicks **Set up project**. The new-project wizard opens prefilled from the bid (name, description, bid number, category, client, and one market per country line with LOI, IR, CPI, currency and sample size as the target). A won bid can only ever become one project.

Bids themselves stay in SampBidx. SampTrek stores only what it needs to start the project.

## Setup (once per organization)

1. In SampTrek, an admin opens **Settings → SampBidx connection** and clicks **Connect SampBidx**. SampTrek shows the endpoint, the tenant slug and a signing secret (`sbx_…`; secrets made before the rename start with `bzw_` and keep working). The secret is shown once.
2. SampBidx stores the endpoint, tenant and secret for that organization.
3. **Rotate secret** issues a new one and invalidates the old one immediately. **Turn off** stops all intake (every delivery gets 401).

## Request

```
POST {SAMPTREK_API}/api/v1/integrations/sampbidx/events
Content-Type: application/json
X-SampBidx-Tenant: <organization slug>
X-SampBidx-Timestamp: <unix seconds>
X-SampBidx-Signature: sha256=<hex>
```

**Signature:** `hex(HMAC-SHA256(secret, timestamp + "." + rawBody))`, computed over the exact bytes sent. The timestamp must be within **300 seconds** of SampTrek's clock.

**Body:**

```json
{
  "event": "bid.won",
  "eventId": "evt_01J…",                 // unique per delivery attempt or per event; stored for tracing
  "occurredAt": "2026-11-01T09:30:00Z",  // when the bid was won (ISO 8601 with offset)
  "bid": {
    "id": "b9c1…",                       // SampBidx bid id: the idempotency key
    "bidNumber": "BID-2026-0412",
    "version": 3,                        // optional
    "projectName": "Retail shopper journey tracker",
    "projectDescription": "…",           // optional
    "projectType": "Tracker",            // optional
    "projectCategory": "B2C",            // optional; matched to SampTrek categories case-insensitively
    "currency": "USD",                   // ISO 4217
    "totalAmount": 18450,                // optional
    "client": { "id": "c-17", "name": "Acme Insights" },   // matched to a SampTrek client by name
    "contact": { "name": "Jordan Buyer", "email": "jordan@example.com" },   // optional
    "biddingPerson": { "name": "Sam Sales", "email": "sam@example.com" },  // optional
    "countries": [
      { "countryCode": "US", "sampleSize": 800, "loiMinutes": 15, "incidencePct": 45, "cpi": 3.75, "language": "en", "notes": "" }
    ]
  }
}
```

`countries` maps to SampBidx's `bid_country_lines` (`country_code`, `sample_size`, `loi_minutes`, `incidence_pct`, and `cpi_override` or `cost_per_complete` as `cpi`). 1 to 200 lines. `countryCode` is ISO 3166 alpha-2 in upper case.

## Responses

| Status | Meaning | SampBidx should |
|---|---|---|
| `202 {wonBidId, status, duplicate:false}` | New won bid stored | Mark delivered |
| `202 {wonBidId, status, duplicate:true}` | Already received (same `bid.id`) | Mark delivered |
| `400 {message, issues[]}` | Body failed validation | Fix the payload; do not retry as is |
| `401` | Unknown tenant, connection off, bad signature, or stale timestamp (same answer for all) | Check config and clock; retry after fixing |
| `5xx` / timeout | SampTrek problem | Retry with backoff |

## Idempotency and updates

- Deliveries are keyed on (organization, `BIDZO`, `bid.id`) (the stored source keeps its old name). Retrying is always safe.
- A re-delivery while the bid is still **Waiting for setup** updates the stored copy (for example a revised bid version). Once a project has been created from it, or it was dismissed, later deliveries are acknowledged but change nothing.
- Creating the project and claiming the won bid happen in one transaction. A second attempt gets `409` and leaves no gap in project numbering.

## Signing example (Node)

```js
import crypto from 'node:crypto';

const body = JSON.stringify(event);
const ts = Math.floor(Date.now() / 1000).toString();
const sig = crypto.createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');

await fetch(`${SAMPTREK_API}/api/v1/integrations/sampbidx/events`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-SampBidx-Tenant': tenant, 'X-SampBidx-Timestamp': ts, 'X-SampBidx-Signature': `sha256=${sig}` },
  body,
});
```

## SampTrek endpoints behind the screens

| Endpoint | Who | Purpose |
|---|---|---|
| `GET /won-bids?status=NEW\|PROJECT_CREATED\|DISMISSED` | signed-in staff | List with per-status counts |
| `GET /won-bids/:id` | signed-in staff | One bid plus `suggestedClient` |
| `POST /won-bids/:id/dismiss` `{reason?}` / `POST /won-bids/:id/restore` | admin, PM | Hide a bid that will not run, or bring it back |
| `POST /projects` with `wonBidId` | admin, PM | Create the project and claim the bid |
| `GET /integrations/sampbidx` | signed-in staff | Endpoint, tenant, enabled, last received |
| `POST /integrations/sampbidx/secret` / `POST /integrations/sampbidx/disable` | admin | Rotate (returns the secret once) or turn off |

Every intake, project creation from a bid, dismiss, restore, rotate and disable is written to the audit log.

## Names kept from Bidzo

A SampBidx (or older Bidzo) build that is already set up keeps working without any change.

| New name | Old name, still accepted | Notes |
| --- | --- | --- |
| `POST /api/v1/integrations/sampbidx/events` | `POST /api/v1/integrations/bidzo/events` | Same handler, same answers |
| `X-SampBidx-Tenant`, `X-SampBidx-Timestamp`, `X-SampBidx-Signature` | `X-Bidzo-Tenant`, `X-Bidzo-Timestamp`, `X-Bidzo-Signature` | The new header wins when both are sent |
| `GET /integrations/sampbidx`, `POST /integrations/sampbidx/secret`, `POST /integrations/sampbidx/disable` | the same under `/integrations/bidzo` | Used by Settings → SampBidx connection |
| New secrets `sbx_…` | `bzw_…` | Only the prefix of new secrets changed; existing secrets stay valid |
| Integration field `SAMPBIDX_URL` (Settings → Integrations → SampBidx link) | `BIDZO_URL` | Links saved before the rename are read as `SAMPBIDX_URL`; saving the card again stores the new key |
| Web build env `NEXT_PUBLIC_SAMPBIDX_URL` | `NEXT_PUBLIC_BIDZO_URL` | Fallback only; admins normally set the link in the app |
| `/auth/me` → `links.sampbidxUrl` | `links.bidzoUrl` | Both are sent with the same value, for phone app builds from before the rename |
| Audit actions `integration.sampbidx.secret-rotated`, `integration.sampbidx.disabled` | `integration.bidzo.*` | Older log entries keep their old action names |

These stay `bidzo` on purpose because they are stored data, and renaming them would need a
database migration or reset saved switches. People never see them:

- Integration kind `bidzo` and the Super Admin feature key `integration.bidzo`.
- Database column `Organization.bidzoWebhookSecret` and `WonBid.source = "BIDZO"` (part of the idempotency key).
