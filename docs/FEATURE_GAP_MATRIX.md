# Feature gap matrix

Classification follows the spec: **EXISTING** (done in this repo and tested), **PARTIAL**, **MISSING**, **NEEDS_REFACTORING**, **EXTERNAL_DEPENDENCY**.
"Existing" refers to this repository after milestone 1, not to the legacy Fieldwork platform (see `EXISTING_FEATURE_INVENTORY.md`).

| Module (spec) | Capability | Status | Notes |
|---|---|---|---|
| Foundation | Multi-tenant organizations, every query scoped by tenant | EXISTING | e2e test proves cross-tenant 404s |
| Foundation | Login, roles (admin, PM, sales, viewer), audit log | EXISTING | Client/vendor portal roles exist in the schema but have no screens |
| Foundation | SSO (SAML/OIDC), MFA | MISSING | Phase 8 |
| 1 Project factory | Master project with many countries, shared settings plus overrides | EXISTING | |
| 1 | Country clone (with vendors and quotas), Excel/CSV paste | EXISTING | |
| 1 | Project templates, version history of project settings, draft saving | PARTIAL | Projects start as Draft; settings changes are in the audit log, no template library yet |
| 1 | Quota cells, nested/interlocking quotas | PARTIAL | Country and vendor targets are enforced atomically; quota cells can be stored but are not enforced at entry |
| 1 | AI-assisted and API-driven project creation | MISSING | Phase 2/6 |
| 2 RFQ & feasibility | RFQ extraction, feasibility | MISSING / EXTERNAL_DEPENDENCY | RFQs belong to Bidzo; PROJEXA should consume a "bid won" event |
| 3 Vendors | Vendor records, per-country allocation with CPI and target, pause/resume | EXISTING | |
| 3 | Vendor scoring, capacity, AI matching | MISSING | Needs delivery history first |
| 4 Fieldwork autopilot | Monitoring, pacing, alerts | MISSING | Phase 5 |
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
| 5.1 | Redirect health dashboard | PARTIAL | 24h counts on the dashboard; no charts or breakdowns yet |
| 6 Quotas | Atomic over-quota protection for country and vendor targets | EXISTING | Concurrency handled by conditional SQL updates |
| 6 | Quota cells, reallocation suggestions | MISSING | |
| 7 Quality | Duplicate detection (same UID; optional same device) | EXISTING | |
| 7 | Gate survey, captcha, geolocation, fingerprinting, TOR, cookies, language, timezone | PARTIAL | Stored per project, not enforced yet |
| 8 / 9 Portals | Client and vendor self-service portals | MISSING | Phase 3 |
| 10 API hub | Public REST API with OpenAPI docs, API keys, webhooks | MISSING | Internal REST API exists |
| 11 / 12 AI & voice | Copilot, agents, voice commands | MISSING | Phase 6 |
| 13 Finance | Revenue/payout per complete, approve/reject completes | PARTIAL | Invoices, FX and reconciliation exports missing |
| 14 Reporting | Overall / conversion / client / vendor / clicks reports | MISSING | Data is captured; views not built |
| 15 Dashboard | PM dashboard tiles and live projects | PARTIAL | No charts, date range, or top-5 lists |
| 19 Compliance | Hashed IPs, tenant isolation, audit trail | PARTIAL | Retention policies and consent per country missing |
| 20 SaaS | Plans, white labeling | MISSING | Phase 8 |
| 22 Testing | Unit + e2e tests for redirects, tenancy, roles, quotas, callbacks | EXISTING | 40 tests; no browser e2e or load tests yet |
