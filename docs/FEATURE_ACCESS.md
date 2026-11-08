# Feature access: Super Admin → plan → Admin → users

Kunal's rule (2026-11-08): every feature of SampTrek is controlled the way team chat is. The Super Admin
decides what each subscription plan includes and can allow extras per organisation. An organisation's
Admin only gets what their plan (plus extras) gives them, and then decides which of their users get it.

## The layers

| # | Who | Where | What it does |
|---|-----|-------|--------------|
| 1 | Super Admin | Super Admin → Plans | Which features each plan includes, on the web and in the app |
| 2 | Super Admin | Super Admin → Organisations → Features | Per organisation: give an **extra** feature the plan does not include, or take one away |
| 3 | Organisation Admin | Settings → Features & access | Who in the team gets each feature the organisation has |
| 4 | Super Admin | Super Admin → Organisations → People | Take a feature away from one person |

The person's role still applies on top (for example Accounting is for admins and project managers).

### Layer 3: the Admin's choices

For each feature the organisation has, the Admin picks one of:

- **Everyone** — everyone whose role can use it (the default for features people already had).
- **Admins only** — only the organisation's admins.
- **Chosen people** — admins plus the people the Admin ticks.
- **No one** — hidden for the whole organisation, admins too.

New features such as **Team chat** start as **Admins only** (`adminDefault: 'admins'` in
`apps/api/src/super-admin/features.ts`), so users only see them once the Admin allows them.

Features outside the plan are shown **locked** ("Not in your plan" or "Turned off by your provider"), and the
API refuses to save a choice for them (`403 FEATURE_NOT_IN_PLAN`). Settings and Team cannot be changed here,
so an Admin cannot lock themselves out. Admin-only features (Integrations, Branding, Privacy, API and webhooks)
have no choice to make. If the Super Admin later takes a feature away and gives it back, the Admin's earlier
choice applies again.

The Super Admin sees each Admin's choices in the "Admin gives it to" column of Organisations → Features.

## Enforcement

`userGrants()` in `apps/api/src/super-admin/entitlements.ts` applies all layers. It feeds:

- the auth guard, which refuses gated routes with `403 FEATURE_DISABLED` on the web and in the app;
- `GET /auth/me/features`, which the web menu, Ctrl K, page guard and the Android/iOS app read.

So a change hides the feature from the menu within seconds and the server refuses it at once.

Stored on `Organization.featureAccess` (JSON): `{ "<featureKey>": { "mode": "everyone" | "admins" | "people" | "off", "people": ["<userId>"] } }`.
Missing keys use the feature's default. Changes are written to the audit log as `feature_access.update`.

## API (organisation admins)

- `GET /api/v1/feature-access` — every feature with `available`, `source` (`plan`, `extra`, `not_in_plan`, `taken_away`), `controllable`, `mode`, `people`, plus the team list.
- `PUT /api/v1/feature-access/:feature` `{ "mode": "people", "people": ["<userId>"] }`.

## Features with their own switch

Besides the existing keys (see docs/SUPER_ADMIN.md), these now have their own switch so the Super Admin can sell them separately:

| Key | Feature | Routes |
|-----|---------|--------|
| `chat` | Team chat (PR #70) | `chat/*` |
| `collaboration` | Comments, @mentions, handovers, activity feed (PR #65) | `projects/:id/comments\|handovers\|activity\|mentionable` |
| `client_dashboards` | Live client dashboard links (PR #63) | `projects/:id/dashboard-links` |
| `vendor_routing` | Vendor auto-routing (PR #66) | `projects/:id/routing`, `projects/:id/countries/:countryId/route` |
| `fraud_checks` | Advanced fraud checks (PR #67) | `projects/:id/fraud/*`, `security/ip-lists/*` |
| `forecasting` | Finish date, cost and margin forecast (PR #64) | `monitor/forecast`, `projects/:id/forecast` |
| `languages` | Hindi, Spanish and other languages (PR #69) | UI only, see below |

The migration `20261111090000_feature_access` adds `collaboration`, `client_dashboards`, `vendor_routing` and
`fraud_checks` to existing plans that include `projects`, `forecasting` to plans with `monitor`, and `languages`
to every plan, so nobody loses something they had. Team chat is not added to existing plans: the Super Admin
adds it where it belongs. New starter plans: Starter gets comments, client dashboards and languages;
Professional adds chat, forecasting, vendor routing and fraud checks; Enterprise gets everything.

### What the open PRs still need when they merge

- **#63 client dashboards**: the public link (`public/dashboard/:token`) is not signed in, so its service should
  also check `entitlements.orgAllows(orgId, 'client_dashboards')` before showing a dashboard; the project tab should be hidden when `features.web.client_dashboards` is false.
- **#64, #65, #66, #67**: hide their project tabs, panels and buttons when the feature is off (`hasFeature(me, key)`). The API side already follows the table above.
- **#69 languages**: show the language picker only when `features.web.languages` is true and fall back to English otherwise; the language preference route lives under `auth/` (never gated), so the check is in the UI and in the preference save.
- **#70 team chat**: drop its own `chat` entry in `features.ts` (identical to this one) when rebasing.
- **#68 backups and status page** are server-wide Super Admin tools, not organisation features, so they stay Super Admin only and are not in plans.
