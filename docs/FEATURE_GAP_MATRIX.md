# Feature gap matrix

Classification follows the spec: **EXISTING** (done in this repo and tested), **PARTIAL**, **MISSING**, **NEEDS_REFACTORING**, **EXTERNAL_DEPENDENCY**.
"Existing" refers to this repository after milestone 1, not to the legacy Fieldwork platform (see `EXISTING_FEATURE_INVENTORY.md`).

| Module (spec) | Capability | Status | Notes |
|---|---|---|---|
| Foundation | Multi-tenant organizations, every query scoped by tenant | EXISTING | e2e test proves cross-tenant 404s |
| Foundation | Login, roles (admin, PM, sales, viewer), audit log | DONE | Portals have screens (milestone 2); staff team screen with invitations, roles, deactivation and sign-out everywhere, plus password reset by email (milestone 18) |
| Foundation | SSO (SAML/OIDC), MFA | DONE (milestone 13: MFA with authenticator apps, recovery codes, org-wide requirement for staff, admin reset; milestone 15: OIDC sign-in with Google, Microsoft and Zoho, per-org domains and tenant, SSO-only mode) | SAML for other identity providers if a client asks |
| 1 Project factory | Master project with many countries, shared settings plus overrides | EXISTING | |
| 1 | Country clone (with vendors and quotas), Excel/CSV paste | EXISTING | |
| 1 | Project templates, version history of project settings, draft saving | DONE (milestone 23) | Template library with optional quotas, vendors, client and survey links; autosaved Create project drafts; per-project settings versions with before/after and restore |
| 1 | Quota cells, nested/interlocking quotas | EXISTING | Milestone 10: cells on device and gate/prescreen answers, combined conditions, enforced at entry, after the gate page and at complete (docs/QUOTAS.md) |
| 1 | AI-assisted and API-driven project creation | PARTIAL | The AI copilot creates projects after confirmation (milestone 20); creating from a brief or document in one step is not built |
| 2 RFQ & feasibility | RFQ extraction, feasibility | PARTIAL / EXTERNAL_DEPENDENCY | RFQs and feasibility stay in Bidzo. PROJEXA consumes the signed `bid.won` event into Won bids and prefills the project (milestone 5); Bidzo still has to send it |
| 3 Vendors | Vendor records, per-country allocation with CPI and target, pause/resume | EXISTING | |
| 3 | Vendor scoring, capacity, AI matching | MISSING | Needs delivery history first |
| 4 Fieldwork autopilot | Monitoring, pacing, alerts | DONE (milestone 9: monitor, alerts, autopilot, webhook) | Phase 5 |
| 5 Survey links | Vendor entry links (live and test), opaque session tokens, client survey link macros | EXISTING | |
| 5 | Canonical respondent event log, idempotent outcomes, out-of-order and duplicate handling | EXISTING | First terminal status wins; later conflicting statuses are logged |
| 5 | Signed S2S outcome confirmation from client platforms | EXISTING | HMAC-SHA256 with timestamp window |
| 5.1 Redirects | Static, dynamic and hybrid modes (hybrid default), all 8 statuses | EXISTING | |
| 5.1 | UID, vendor ID, country code parameters with per-vendor aliases | EXISTING | |
| 5.1 | Project, country, vendor, vendor+country overrides; client template; organization default | EXISTING | Deterministic precedence; equal-specificity conflicts fail validation |
| 5.1 | Domain allowlist, https only, no credentials in URLs, loop prevention, safe fallback | EXISTING | |
| 5.1 | Versioning, draft → approve/activate, rollback, sessions pinned to their version | EXISTING | |
| 5.1 | QA studio (all 8 statuses, no billable records), effective routing view | EXISTING | |
| 5.1 | Vendor callbacks via outbox: retries, backoff with jitter, dead letter, replay, signatures | EXISTING | Worker runs in the API process; Redis/BullMQ later if volume requires |
| 5.1 | API-resolved dynamic destinations, scheduled activation, version diff view | MISSING | |
| 5.1 | Redirect health dashboard | PARTIAL | 24h counts on the dashboard; outcome mix and event log in Reports |
| 6 Quotas | Atomic over-quota protection for country and vendor targets | EXISTING | Concurrency handled by conditional SQL updates |
| 6 | Quota cells, reallocation suggestions | DONE | Cells, open/close, live progress and full-cell alerts (milestone 10); vendor reallocation suggestions with one-click apply (milestone 17). Per-cell vendor targets not modelled |
| 7 Quality | Duplicate detection (same UID; optional same device) | EXISTING | |
| 7 | Gate survey, captcha, geolocation, fingerprinting, TOR, cookies, language, timezone | EXISTING | All enforced since milestone 6, plus gate survey and prescreener question builder and per-project captcha style (see `docs/RESPONDENT_SECURITY.md`). Geolocation needs a CDN country header |
| 8 Client portal | Own projects (non-draft), progress by market, spend, approve/reject completes, CSV | EXISTING | Milestone 2. Never shows vendors, vendor UIDs or payouts |
| 8 | RFQ submission, questionnaire upload, deliverables, tickets, invoices | MISSING | RFQs belong to Bidzo |
| 9 Vendor portal | Own allocations, entry/test links, respondents, payouts by approval state, callback log, CSV | EXISTING | Milestone 2. Never shows client CPI, revenue or other vendors |
| 9 | Self-registration, compliance documents, feasibility/CPI quotes, invoices, disputes | MISSING | |
| 8 / 9 | Portal logins created by staff, deactivation takes effect immediately | EXISTING | Password reset by email (milestone 18); portal users can also use single sign-on if their email domain is on the list |
| 10 API hub | Public REST API with OpenAPI docs, API keys, webhooks | DONE (milestone 12: scoped API keys, /api/v1/public, OpenAPI, signed event webhooks with retries) | Rate limit is per API instance; move to Redis when running several |
| 11 / 12 AI & voice | Copilot, agents, voice commands | DONE (milestone 20: Google Gemini copilot with tools over projects, fieldwork, tasks, team, finance and reports; confirmed actions; document reading; voice with Gemini Live and a browser-speech fallback) | Teams/departments, budgets and expenses are not modelled, so the copilot says so instead of answering; meeting audio is not transcribed (paste notes or upload a text/PDF) |
| 13 Finance | Revenue/payout per complete, approve/reject completes, reconciliation against the client's ID list, client invoices (draft, sent, paid, void) | DONE | Milestone 11 added vendor bills (draft, approved, paid, void), tax on invoices and bills, manual exchange rates and reporting-currency totals. Milestone 16 added accounting exports (Zoho Books, Tally, QuickBooks Online, Xero, journal CSV) with export history. Milestone 19 added payment exports (Zoho Books, Tally, journal) and direct sync to Zoho Books (contacts, invoices, bills, payments, voids; manual or hourly). Milestone 21 added the same direct sync for Xero and QuickBooks Online (OAuth per organisation) and Tally Prime (XML server over a private network) |
| 14 Reporting | Overall / conversion / client / vendor / clicks reports, filters (date, client, project, vendor, market), CSV | EXISTING | Milestone 3. Money shown per currency; margin only for single-currency rows |
| 14 | Scheduled/emailed reports, saved views, FX-converted totals, PDF export | MOSTLY DONE | Reporting-currency totals on the finance tiles and payables (manual rates, milestone 11); report tables still per currency; scheduled email reports with CSV done (milestone 14, Zoho Mail SMTP); saved views (private or shared) and PDF export of reports and invoices done, with optional PDF on scheduled emails (milestone 22); only reporting-currency totals inside report tables remain |
| 15 Dashboard | Command center: KPI tiles, 14-day trend, quota achievement, fieldwork health, alerts | PARTIAL | Drag/resize widgets, map, waterfall, heatmap in design phase 6 |
| 16 UI/UX | Design tokens, 8 themes with light/dark, per-user Theme Studio, motion levels, collapsible shell, command palette, insights panel | EXISTING | Milestone 4; see FRONTEND_DESIGN_SYSTEM.md |
| 16 | Smart form system, advanced data grid, country map, redirect diagram | MISSING | Design phase 5 |
| 11 / 12 | Tasks (create, assign, priority, due date, reminder, one dependency) | DONE | Milestone 20 added a minimal tasks module (`/tasks`) used by the copilot; no subtasks, comments or recurring tasks |
| 19 Compliance | Hashed IPs, tenant isolation, audit trail | PARTIAL | Retention policies and consent per country missing |
| 20 SaaS | Plans, white labeling | MISSING | Phase 8 |
| 22 Testing | Unit + e2e tests for redirects, tenancy, roles, quotas, callbacks, portals, reports, preferences, insights; theme contrast check | EXISTING | 57 API tests; no browser e2e or load tests yet |
