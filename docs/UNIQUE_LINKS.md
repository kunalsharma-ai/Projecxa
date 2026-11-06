# One-time unique links

Staff can generate any number of respondent links for a vendor in a market. Every link has
its own random key and works **once**: the first person to open it enters the survey, and
nobody can enter with it again.

```
https://projexa.example/u/{key}            key = 24 letters and digits, about 140 bits of randomness
https://projexa.example/u/{key}?uid=ABC    optional: the vendor's own respondent ID
```

## Where

Project → **Vendor unique links** tab (editors generate and revoke; viewers can look and download). Links the client made for each respondent are a different feature: see [CLIENT_UNIQUE_LINKS.md](CLIENT_UNIQUE_LINKS.md).

- **Generate**: choose the vendor and market, how many links (1 to 50,000 at a time, 500,000 per project), an optional batch name and an optional time after which unused links stop working.
- **By vendor and market**: links, unused, used, completes, revoked or expired, and the **Unique links only** switch.
- **Batches**: download a batch as CSV, or revoke its unused links.
- **Links**: every key with its link status (Unused, Used, Expired, Revoked), the respondent's outcome, when it was used and how many times someone tried to use it again. Filter by vendor, batch or status, or paste a key or link to find it. **Download as CSV** exports everything that matches the filters.

Vendors see the number of unused links per market in the vendor portal and can download their unused links as CSV.

## Rules

- **Single use, enforced on the server.** Opening a link runs one guarded database update (`UNUSED → USED`). Only one request can win it, so a double click, a second tab, a forwarded link or many simultaneous requests still give exactly one respondent session. The session also stores the link with a unique constraint, so a link can never have two sessions.
- **Later visits** go to the project's Duplicate page (the respondent's own redirect rules, as for a repeated vendor UID) and count as a blocked re-use attempt on the link. Finishing the survey does not reopen the link.
- **Not live yet**: if the project, market or vendor is not live, the respondent sees the Quota full page and the link is **not** used up, so it works once fieldwork starts or resumes.
- **Turned away at entry** (for example a quota already full, a device not allowed, or a duplicate device): the link is used up, because the respondent did enter.
- **Respondent ID**: the key is the respondent ID, unless the vendor appends its own ID with the allocation's UID parameter (`uid` by default). Everything after entry is unchanged: gate page, quotas, redirects, vendor callbacks, reports and invoices work exactly as for the shared vendor link.
- **URL protection** (signed entry links) is not needed for unique links; the unguessable key is the protection.
- **Revoked** and **expired** links go to the Security reject page. Revoking only touches links nobody has used; used links keep their history.
- **Unique links only**: switch it on for a vendor in a market and the shared live vendor link (`/s/{code}`) is refused (Security reject, recorded in the audit log as `respondent.shared-link-blocked`). The test link keeps working.

## CSV columns

`Key, Link, Vendor, Market, Batch, Link status, Used at, Respondent status, Respondent detail, Blocked re-use attempts, Expires at, Created at`

The file starts with a byte-order mark so Excel reads it as UTF-8. Keys contain only letters
and digits (no look-alike characters such as 0/O or 1/l/I), so spreadsheets, e-mail and SMS
keep them intact.

## API (staff, signed in)

| Method | Path | |
|---|---|---|
| `GET` | `/api/v1/projects/:id/unique-links/summary` | Counts per vendor and market, and batches |
| `GET` | `/api/v1/projects/:id/unique-links?allocationId&batchId&status&q&skip&take` | One page of links (`status` = `UNUSED`, `USED`, `EXPIRED`, `REVOKED`) |
| `GET` | `/api/v1/projects/:id/unique-links/export.csv?…same filters` | CSV of every matching link |
| `POST` | `/api/v1/projects/:id/unique-links` | `{ allocationId, count, label?, expiresAt? }` (editors) |
| `POST` | `/api/v1/projects/:id/unique-links/revoke` | `{ batchId }` or `{ linkIds: [...] }` (editors) |
| `POST` | `/api/v1/projects/:id/unique-links/allocations/:allocationId/only` | `{ uniqueLinksOnly: true \| false }` (editors) |
| `GET` | `/api/v1/portal/vendor/allocations/:id/unique-links.csv?all=true` | Vendor portal: own links (unused only unless `all=true`) |

Generating, revoking and the switch are written to the audit log.

## Data

`UniqueLinkBatch` (one generate run) and `UniqueLink` (`key` unique, `status`, `usedAt`,
`blockedAttempts`, `revokedAt`), `RespondentSession.uniqueLinkId` (unique) and
`VendorAllocation.uniqueLinksOnly`. Migration `20261104130000_unique_links`.
