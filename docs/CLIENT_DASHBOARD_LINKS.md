# Live client dashboard links

Clients often ask "how many completes do we have?" several times a day. A **client dashboard link** answers that without a login: a read-only page that shows one project's fieldwork live.

## For project managers

Project page → **Client dashboard** (header button, admins and project managers only).

1. Type who the link is for (only staff see this), optionally a last day it works, and choose what extra it shows.
2. Press **Make link**, then copy it with the copy icon and send it to the client.
3. Each working link shows how often and when it was last opened. Switch **CPI and spend** or **Vendor names** on or off at any time; the client's page picks it up on its next refresh.
4. **Turn off** stops a link at once. Turned-off and ended links stay listed for the record and cannot be switched back on; make a new link instead.

A project can have up to 20 working links (for example one per client team). Every make, change and turn-off is in the audit log (`dashboard_link.created`, `dashboard_link.updated`, `dashboard_link.revoked`).

## What the client sees

`/live/<token>` on the web app (the address staff copy is the one they are using, so custom domains work):

- Project name and ID, status, field dates.
- Completes against target, with a bar, and completes per hour over the last 24 hours.
- In progress, terminates, quota full, removed for quality (quality fail, duplicate and security rejects together), average LOI and incidence.
- Every market with its status, planned LOI and IR, completes against target, and every quota cell with its completes, target and whether it is full or closed.
- Only when **Show CPI and spend** is on: the client CPI per market and the spend so far (sum of the revenue on accepted completes, per currency).
- Only when **Show vendor names** is on: each vendor's name with its completes and target across markets.

Never shown, whatever the settings: vendor CPI, vendor cost, margin, respondent IDs, session tokens, survey or entry links, internal database ids, other projects. Test traffic is never counted.

The page refreshes every 30 seconds while it is visible (and as soon as the tab is shown again).

## When a link stops working

The page says the link does not work and to ask the project manager for a new one when:

- it was turned off,
- its last day has passed, or
- the project is back in **Draft**.

A wrong token gives the same answer, so a guess learns nothing.

## API

Staff (JWT, roles ADMIN and PROJECT_MANAGER):

| Method | Path | Body |
| --- | --- | --- |
| GET | `/api/v1/projects/:id/dashboard-links` | – |
| POST | `/api/v1/projects/:id/dashboard-links` | `{ label?, showMoney?, showVendors?, expiresAt? }` |
| PATCH | `/api/v1/projects/:id/dashboard-links/:linkId` | `{ label?, showMoney?, showVendors?, expiresAt? }` |
| POST | `/api/v1/projects/:id/dashboard-links/:linkId/revoke` | – |

Public (no login): `GET /api/v1/public/dashboard/:token`, limited to 120 requests a minute per network. Unknown, turned-off, ended and draft links answer `404` with code `DASHBOARD_LINK_UNAVAILABLE`.

Tokens are 24 random bytes (32 base64url characters). Table: `ClientDashboardLink`. Code: `apps/api/src/dashboard-links/dashboard-links.ts`, `apps/web/app/live/[token]/page.tsx`, `apps/web/components/project/dashboard-links.tsx`. Tests: `apps/api/test/e2e/dashboard-links.e2e.spec.ts`.
