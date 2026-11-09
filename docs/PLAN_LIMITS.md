# Plan limits

Kunal (2026-11-09): the Super Admin controls, per subscription, how many projects, clicks, completes, users,
clients and vendors an organisation may have, and other controls like these. Features are switched on and off
by plan as described in docs/FEATURE_ACCESS.md; this page covers the **numbers**.

## The limits

| Key | Shown as | What is counted |
|-----|----------|-----------------|
| `users` | Team members | Active staff logins (Plan.maxUsers) |
| `projects` | Projects | Projects in the account, any status (Plan.maxProjects) |
| `projectsPerMonth` | New projects a month | Projects created this calendar month |
| `clients` | Clients | Client accounts |
| `vendors` | Vendors | Vendors, including approved sign-ups |
| `portalUsers` | Portal logins | Active client and vendor portal logins |
| `clicksPerMonth` | Clicks a month | Live respondent entries this calendar month (test links are free) |
| `completesPerMonth` | Completes a month | Live completes this calendar month |
| `scheduledReports` | Scheduled reports | Report emails on a schedule |
| `apiKeys` | API keys | Public API keys not revoked |

Months are calendar months in UTC and reset on the 1st.

## Where they are set

- **Super Admin → Plans**, "Limits in this plan": the numbers every organisation on the plan gets. Empty = no limit.
- **Super Admin → Organisations → (organisation) → Subscription**, "Limits for this organisation": empty follows the
  plan, a number replaces it, `none` removes the limit for that organisation only. The Usage card next to it shows use against each limit.
- Stored in `Plan.limits` and `Subscription.limits` (JSON) next to the existing `maxUsers` / `maxProjects` columns.
  `apps/api/src/super-admin/limits.ts` has the catalog; add a key there and a counter in `EntitlementsService.usage()` to add a limit.

Starter plans (only for new installs; existing plans keep no extra limits until the Super Admin sets them):
Starter 25 clients, 25 vendors, 20 portal logins, 20,000 clicks and 5,000 completes a month, 5 scheduled reports;
Professional 250 / 250 / 250, 250,000 clicks, 50,000 completes, 25 scheduled reports, 5 API keys; Enterprise none.

## What happens at a limit

- Adding a client, vendor, portal login, project, scheduled report, API key or team member over the limit is refused
  with `403 { code: "PLAN_LIMIT", limit, max, used, message }`. CSV imports add rows up to the limit and report the rest.
  Approving a vendor sign-up checks the vendor (and portal login) limit.
- **Clicks and completes** are respondent traffic, so the plan chooses:
  - **Stop new entries** (default): new live entries are sent back to the vendor as *Quota full* with detail
    `PLAN_CLICK_LIMIT` or `PLAN_COMPLETE_LIMIT`. Respondents already in a survey finish normally and test links keep working.
  - **Keep going and show the overrun**: nothing is stopped; the usage bars show it in red.
  Traffic is counted at most every 30 seconds per organisation (plus entries admitted since), so a limit can be overshot by a few entries on a very busy link.
- Admins see usage at **Settings → Subscription → Usage and limits** (`GET /api/v1/billing/usage`), amber at 80%, red when reached.

## Emails when a limit is close or reached

`src/super-admin/limit-alerts.ts` emails the organisation when its usage crosses a line:

| When | Who gets it |
| --- | --- |
| **Close**: 80% of a limit (e.g. 4 of 5 clients, 1,600 of 2,000 clicks) | The organisation's active admins |
| **Reached**: at or over the limit | The organisation's admins and every Super Admin |

- One email per organisation per check lists every limit that crossed a line, with what happens now (for clicks and
  completes: stopped as quota full, or keeps going, as the plan says) and a link to Settings → Subscription.
- Each limit and level emails **once per period**: once a calendar month for monthly limits, and once per limit
  value for the others, so raising a limit lets the emails come again. Going straight to the limit sends only the
  "reached" email. Limits of 0 (not in the plan) never email. Paused organisations and the platform owner are skipped.
- It checks every hour, and a few seconds after something with a limit is added or the traffic counts refresh (at most
  once a minute per organisation). `LIMIT_ALERTS_ENABLED=false` turns it off.
- Emails go through the platform's email settings (Super Admin's organisation, Settings → Integrations). Each one is
  kept in the `LimitAlert` collection, claimed before sending so two servers never both send it. The Super Admin sees
  them on the organisation's **Subscription** tab under **Limit emails**, with who got them or why one was not sent.

## Own name and domain on links

"Redirects with the admin's own name" is the `custom_domain` feature (Own domain on links): survey links, redirects
and respondent pages on the organisation's verified domain. It is separate from `branding` (name, logo, colours) so
a plan can include one without the other. Routes: `branding/domain/*`. The UID prefix with the organisation's
name stays under Settings → Numbering.

## Not included yet

- Limits on AI copilot requests, storage and live projects at the same time.
