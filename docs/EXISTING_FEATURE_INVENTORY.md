# Existing feature inventory (Phase 0)

**Source:** screenshots of the live Sampledge Fieldwork platform (`platform.sampledge.com/member/...`, captured 2026-11-01).
The platform's source code was not available, so this inventory lists what the screens show, not what the backend does.
Any item marked "not visible" may still exist in the backend.

PROJEXA milestone 1 is a fresh codebase. Each item below says how milestone 1 treats it.

## PM dashboard (`/member/dashboard/pm`)

| Visible feature | Detail | Milestone 1 |
|---|---|---|
| Client count | Total plus active/inactive split (54 / 1) | Rebuilt from live data (`GET /dashboard`) |
| Vendor count | Total plus active/inactive split | Rebuilt |
| Project count by status | 190 split into 4 status counts | Rebuilt (`projects.byStatus`) |
| Statistics for a date range | Revenue, cost, profit, clicks, completes with trend % | Totals rebuilt; date range and trend % not yet |
| Reconciliation and invoicing tiles | Total reconciled, invoice pending, invoiced, payment received | Not yet (Phase 7). Approval status per complete exists. |
| Top 5 vendors / projects / clients | Ranked lists | Not yet |
| Live projects table | Project ID, bid number, work order, name, completes, terminates, overquotas, dropouts | Rebuilt as a compact list with progress |
| Monthly revenue chart | Revenue / payout / profit / loss, monthly-weekly-daily, bar-line | Not yet (Phase 7 analytics) |
| Bidding dashboard, vendor dashboard | Menu entries only | Out of scope: bidding belongs to Bidzo |

## Won bids (`/member/project/won`)

| Visible feature | Milestone 1 |
|---|---|
| List of won bids with "create project" and "open project" | Not rebuilt. PROJEXA stores `bidReference` on the project; the Bidzo "bid won" event that should create a draft project is planned in Phase 3/4 (see integration plan). |

## Create project (`/member/project/create`)

| Visible field | Milestone 1 |
|---|---|
| Project name, work order no. with GENERATE | Yes. Work order can be typed or generated (`WO` + sequence per tenant). |
| Project type (Ad-hoc), category, client, client contact, sales person, project manager | Yes. Types: ad-hoc, tracker, longitudinal, qualitative. |
| Rich-text description | Plain text for now |
| Devices: desktop, mobile, tablet | Yes (stored per project; enforcement at entry is not yet built) |
| Security: gate survey, prescreening, URL protection, geolocation, browser fingerprinting, captcha, duplicate detection, browser language, timezone tracking, TOR detection, cookie validation | All 11 toggles stored as one security policy per project. **Only duplicate detection is enforced in milestone 1** (same IP + user agent within a project). The others are stored for the Respondent Quality Engine (Module 7). |
| Countries toggle and country picker | Replaced by the multi-country editor |
| Per-country table: country, language, target group, LOI, IR, CPI, completes | Yes, with shared defaults and per-country overrides, Excel paste and currency per country |

## Manage projects (`/member/project/list`)

| Visible column / control | Milestone 1 |
|---|---|
| Project status (Live, Hold, Test, Close) | Yes, plus Draft and Invoiced |
| Work order no., project name, client | Yes |
| Completes progress bar (x / target) | Yes |
| Terminates, overquotas, dropouts | Yes, counted from respondent sessions |
| LOI, IR | Yes (average across countries) |
| Project manager, sales person, sample options, category | PM and category yes; sample options not yet |
| Link status (e.g. 4/4, 0/1) | Not yet; live countries count is returned by the API |
| Created on, description | Yes |
| Filters: status, sample options, category; search; CSV download | Status, category and search yes; CSV export not yet |
| Pagination | Yes |
| Marketplace projects (menu) | Out of scope (DIY Marketplace product) |

## Reports (`/member/report/*`)

| Report | Visible content | Milestone 1 |
|---|---|---|
| Overall | Client, vendor, project and financial metrics | Not yet. Data model supports it (sessions carry revenue, payout, status, country, vendor). |
| Conversion | UID, VID, status, revenue, payout, LOI, approval | Partly: the project "Respondents" tab lists UID, vendor, status, revenue, payout, approval. LOI per respondent is not captured yet. |
| Client | Revenue, payout, profit, clicks, conversion per client | Not yet |
| Vendor | Vendor economics, clicks, conversion, profit | Per-vendor completes/terminates/quota full per country on the project page |
| Clicks | Respondent-level events and response status | Respondent events are stored (`RespondentEvent`); no report screen yet |

## Not visible in the screenshots

Client portal, vendor portal, API connectivity, survey link and redirect configuration, callbacks, AI and voice features.
Milestone 1 adds the survey link, redirect and callback engine; the rest is planned in later phases.
