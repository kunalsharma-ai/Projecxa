# Super Admin: observe any organisation

Kunal (2026-11-09): organisations may run SampTrek under their own name and domain, but the Super Admin keeps
control and can see and observe all of their information.

## Observe (read-only)

Super Admin → Organisations → (organisation) → **Observe (read-only)** opens that organisation's workspace as its
Admin sees it: projects, links, redirects, respondents, quotas, clients, vendors, invoices, payables, reports,
settings and branding. Every page is available, whatever the organisation's plan.

- **Nothing can be changed.** Any request other than GET is refused with `403 OBSERVE_READ_ONLY`; only "Exit observe mode" and sign out work.
- **Transparent.** Each start writes `superadmin.observe` to that organisation's activity log, and a banner stays on every page.
- **Short-lived.** The observe pass (cookie `projexa_observe`, or header `X-Observe-Token`) lasts one hour, is signed with its own key, and only works together with the same Super Admin's own session.
- Pause access, plan, features, limits and people are still controlled from the Super Admin console (docs/SUPER_ADMIN.md, docs/PLAN_LIMITS.md, docs/FEATURE_ACCESS.md).

## Traffic tab

Super Admin → Organisations → (organisation) → **Traffic** (`GET /api/v1/super-admin/organizations/:id/traffic?days=7|30|90`):
clicks, completes, incidence, respondents in a survey now, live projects, clicks and completes per day, the busiest
projects, and **Runs as**: the brand name, own domain (and whether it is verified) and respondent ID prefix the
organisation uses. Test links are left out.

## Not included

- Observing from the mobile app (web only).
- Acting as the organisation (changing things on its behalf). Changes stay with the organisation's own admins, or the Super Admin console.
