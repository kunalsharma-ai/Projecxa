# Survey and vendor integration

## Respondent flow

```
Vendor ──► GET /s/{entryCode}?uid=VENDOR_UID
             │  session created, opaque token issued
             ▼
Client survey  (liveSurveyUrl with {session_token} replaced)
             │
             ▼
GET /r/{status}?token=TOKEN           (browser, at the end of the survey)
             │  outcome recorded once, redirect resolved
             ▼
Vendor or client destination (static or dynamic URL)
             +  queued S2S callback to the vendor, if the rule asks for one
```

## For vendors

- Each vendor gets one live and one test entry link per country, e.g. `https://projexa.example/s/Ab12Cd34?uid=[UID]`.
- The UID parameter name is configurable per allocation (`uid` by default).
- Test links create sessions flagged as test. They never count toward quotas, revenue, payout or callbacks.
- Re-entering with the same UID results in the **Duplicate** redirect.
- **One-time unique links** (`/u/{key}`): staff can generate any number of single-use links per vendor and market, each with its own random key, and can close the shared link so only unique links work. See [UNIQUE_LINKS.md](UNIQUE_LINKS.md).
- Callbacks (optional) are `GET` requests to the vendor's URL template. Macros: `{uid}`, `{status}`, `{vendor_id}`, `{country_code}`, `{project_code}`. Headers:
  - `X-Idempotency-Key`: the same for every retry of one callback
  - `X-Projexa-Timestamp`: unix seconds
  - `X-Projexa-Signature`: hex HMAC-SHA256 of `timestamp.url.body` with the vendor's callback secret
- Retries: exponential backoff with jitter (30s, 60s, 120s … capped at 1h), up to 6 attempts, then dead letter. 4xx responses other than 408 and 429 are treated as permanent failures. Failed callbacks can be replayed by a project manager.

## For client survey platforms

- The survey link receives an opaque `session_token`; put `{session_token}` where your platform expects the respondent ID. If the link has no macro, SampTrek appends `token=...`.
- Other macros: `{country_code}`, `{project_code}`.
- At the end, redirect the browser to `/r/{status}?token={token}` (`rid` is accepted too). Status slugs:

| Slug | Status |
|---|---|
| `complete` | Complete |
| `terminate`, `screenout` | Terminate |
| `quota_full`, `overquota` | Quota full |
| `quality_fail` | Quality fail |
| `duplicate` | Duplicate |
| `security_reject` | Security reject |
| `partial`, `abandoned` | Partial |
| `technical_error`, `error` | Technical error |

- **Server-to-server confirmation** (recommended): `POST /api/v1/s2s/outcome` with JSON
  `{ "token": "...", "status": "complete", "timestamp": 1793520000, "signature": "<hex>" }`
  where `signature = HMAC-SHA256(clientSecret, token + "." + status + "." + timestamp)`. Requests more than 5 minutes off are rejected. Responses: `200` recorded or already recorded with the same status, `401` bad signature or timestamp, `404` unknown token, `409` a different status was already recorded.

## Outcome rules

- The first outcome wins. Repeats are idempotent; a different later status is logged as a conflict and does not change the session.
- A browser **Complete** is recorded with approval `PENDING`; it is not billable until approved. An S2S confirmation marks it verified.
- A complete arriving after the country or vendor target is full becomes **Quota full** with detail `OVERQUOTA` (shown as an overquota in reports).
- An expired session (default lifetime 4 × LOI, at least 60 minutes) that returns through the browser becomes **Security reject** with detail `EXPIRED`.
- Unknown tokens go to SampTrek's neutral end page.
