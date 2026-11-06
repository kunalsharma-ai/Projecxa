# SampTrek by Sampledge

<img src="apps/web/public/brand/samptrek-logo-light.svg" alt="SampTrek. Projects on track. by Sampledge" height="64">

**Projects on track.** SampTrek was called PROJEXA until November 2026; see `docs/BRAND.md` for the logo files and the internal names that keep the old name on purpose.

Research project management and fieldwork automation: multi-country projects, vendor allocation, secure survey links, hybrid redirects, callbacks and reconciliation.

This is **milestone 1**: the foundation, multi-country project setup, and the survey link / redirect engine (Module 5 and 5.1 of the spec). See `docs/` for the feature inventory, gap matrix and architecture plan.

## What's in milestone 1

- **Foundation**: multi-tenant organizations, login (httpOnly cookie or bearer token), roles (admin, project manager, sales, viewer), audit log.
- **Projects**: one master project across many countries, with shared settings and per-country overrides (language, LOI, IR, CPI, currency, completes, survey links). Excel paste, country cloning, the 11 security toggles from the current platform, devices, status workflow with a go-live check.
- **Vendors**: per-country allocations with CPI and targets, live and test entry links, pause/resume.
- **Survey engine**: opaque session tokens (the vendor UID never reaches the client survey), idempotent outcomes, duplicate detection, atomic quota control (overquotas are counted, never billed), signed server-to-server confirmation, complete approval.
- **Redirects**: static, dynamic and hybrid (default) modes; all 8 statuses; UID / vendor ID / country code parameters with per-vendor names; project, country, vendor and vendor+country overrides; client template and organization default; domain allowlist; versioning with approve/activate and rollback; QA studio and effective-routing view.
- **Callbacks**: outbox with retries, backoff with jitter, dead letter and replay; HMAC-signed requests.

## Milestone 2: client and vendor portals

- **Vendor portal** (`/portal/vendor`): the vendor's own projects with entry and test links, CPI, LOI, IR and progress; respondents with status, approval and payout (CSV); callback delivery log; payout totals by approval state.
- **Client portal** (`/portal/client`): the client's own live, test, on-hold and closed projects; progress by market; spend; review completes by the respondent ID their survey received, download CSV, approve or reject.
- **Portal access** (staff): create client and vendor logins, deactivate them instantly.
- Portal users cannot reach any staff endpoint, and each portal only returns its own company's data (covered by e2e tests).

## Milestone 3: fieldwork reports

The five reports of the current Fieldwork platform, at `/reports`, with one filter bar (date range in UTC days, client, project, vendor, market):

- **Overall**: clicks, completes (pending and rejected), conversion, median LOI, revenue, payout and profit per currency, completes per day, outcome mix, top clients, vendors and projects.
- **Conversion**: one row per respondent with UID, project, client, market, vendor, status, approval, S2S check, LOI, revenue and payout; status filter, paging, CSV export (up to 50,000 rows).
- **Clients** and **Vendors**: the same metrics grouped by client (or market) and by vendor (optionally split by market), with totals and CSV.
- **Clicks**: the respondent event log (entries, outcomes, repeat entries, repeated or conflicting outcomes), with CSV.

Test traffic never counts. Revenue and payout leave out rejected completes. Money stays in each market's currency until FX conversion exists. The demo seed now adds three weeks of synthetic traffic so the reports have data.

## Milestone 4: design system, themes and new workspace shell

Applies the frontend design prompt (see `docs/FRONTEND_DESIGN_SYSTEM.md` for the full audit, tokens, components and phases):

- **Theme Studio** (`/settings/appearance`): 8 themes (Midnight Intelligence, Arctic Executive, Emerald Matrix, Obsidian Gold, Royal Sapphire, Aurora Rose, Graphite Minimal, Solar Executive), each in light and dark, plus accents, surfaces, sidebar style, border, gradient and glass strength, font size, density, corner radius, motion level (Essential, Refined, Cinematic) and chart palette. Saved per user; contrast is kept at WCAG AA automatically.
- **Shell**: collapsible sidebar with favorites and recent projects, command bar with `Ctrl/⌘ K` search and commands, quick create, alerts, theme switcher and a hideable insights panel (rules-based alerts and recent activity).
- **Command center** dashboard with a 14-day completes trend and quota achievement.
- Shortcuts: `Ctrl/⌘ K` or `/` search, `[` sidebar, `]` insights.

## Milestone 5: won bids from Bidzo

- When a bid is won in Bidzo, it shows up automatically in **Won bids** (`/won-bids`), with a count badge in the sidebar and an item in the insights panel.
- **Set up project** opens the new-project wizard prefilled from the bid: name, description, bid number, category, client (or one click to add the client), and one market per bid country with LOI, IR, CPI, currency and sample size as target. Each won bid becomes at most one project.
- Bids that will not run can be dismissed with a reason and restored later.
- Admins connect Bidzo under **Settings → Bidzo connection** (endpoint, tenant and a signing secret shown once). The webhook contract for the Bidzo side is in `docs/BIDZO_INTEGRATION.md`.
- The demo seed adds three synthetic won bids.

## Milestone 6: gate survey, question builder and respondent security

- **Gate & security tab** on each project: every security setting now blocks for real (entry link signing, device types, TOR, geolocation, duplicates by IP, fingerprint and cookie, browser language, time zone), with a note when something needs server setup.
- **Respondent gate page** before the client survey: human check → gate survey → prescreener → browser checks → client survey. Phone-first, no branding, test links run every check but never block.
- **Question builder** for gate survey and prescreener questions: single choice, multiple choice, dropdown, number, text and grid, with validations (required, ranges, whole numbers, number of choices, length, format) and rules (screen out, must pick one of, qualifying number range). Standard demographics, financial and education questions come from a library.
- **Captcha style per project**, free options only: math, logic, picture text, invisible, Cloudflare Turnstile and hCaptcha (admins add those keys in Settings). Google reCAPTCHA is left out because its free tier stops at 10,000 checks a month.
- **Answers** tab on each project and an **Answers** report: per-question counts, filter by any answer, status and market, and CSV export.
- Details: `docs/RESPONDENT_SECURITY.md`.

## Milestone 7: designed respondent pages

- **Respondent pages tab** on each project: pick one of six templates (Aurora, Minimal, Split, Spotlight, Bold, Playful), a colour palette or your own colours (with a readability warning), font, corner style, brand name, logo, hero picture and footer.
- **Words per page**: own heading, message and an optional https button for complete, terminate, quota full, quality fail, duplicate, security reject, partial and technical error. Blank fields fall back to friendly defaults.
- **Live preview** of every page and the gate page, at desktop and phone width, before saving.
- **Confetti** on complete (skipped when the respondent turns off motion), and an optional **countdown page** shown before a vendor's own return link.
- The gate page uses the same design. Pages are server-rendered with a strict nonce CSP, no outside fonts or scripts; images are checked by their bytes and served from `/pa/:id`.
- Details: `docs/RESPONDENT_PAGES.md`.

## Milestone 8: reconciliation, invoicing and finance dashboard

- **Reconcile & invoice tab** on each project: paste or load the client's ID list (session tokens or vendor UIDs), choose final list, approve listed or reject listed, preview exactly what changes, then apply. IDs that match nothing or that we recorded as another outcome are flagged for the client. Every run is kept in a history.
- **Invoices** from approved completes: one draft per currency with a line per market and price, then sent (with payment terms), paid or void. Invoiced completes are locked; voiding releases them. Printable invoice page (print or save as PDF), invoice list with filters and CSV.
- **Command center**: date range with trend % against the previous period, reconciliation and invoicing tiles, top 5 vendors, projects and clients, and a revenue, payout and profit chart (daily, weekly or monthly; bars or lines; table view).
- **Projects list**: link status (live links / all links) and CSV export of every matching project.
- Details: `docs/FINANCE.md`.

## Milestone 9: fieldwork monitor and autopilot

- **Fieldwork monitor** page: every live market with pace (per day against needed per day, ETA, days left), IR and LOI against plan, last-24h entries, and vendor links with quality and drop-out shares. Pause or reactivate a link in place.
- **Alerts** checked every five minutes or on demand: stalled, behind pace or overdue, low incidence, LOI too short or long, quality spike, drop-out, near target, target reached and failed callbacks. One alert per problem; it clears itself when the problem goes away, or can be acknowledged and resolved.
- **Autopilot** per project: pause a vendor link on a quality spike, close a link once it hits its target. Every action is audited.
- **Project Monitor tab** with field start and end dates; **Settings → Fieldwork alerts** for thresholds and a signed webhook (Slack or Teams relay).
- Details: `docs/FIELDWORK_MONITOR.md`.

## Milestone 10: quota cells

- **Quotas tab** on each project: split a market's target into cells by device or by answers to the gate survey and prescreener (choices or number ranges such as age 18–34). Conditions combine, so cells can interlock (women aged 18–34). Quick add creates one cell per answer with an even split of the target.
- **Enforced** at entry (device cells), after the gate page (answer cells) and again at the complete, atomically with the market and vendor targets: a respondent whose cell is full or closed goes to quota full, and a complete that would overfill a cell is recorded as overquota.
- Cells show completes, respondents still in the survey, and can be closed or reopened in one click. The fieldwork monitor shows them per market and raises an alert when one fills.
- Details: `docs/QUOTAS.md`.

## Milestone 11: vendor payables, tax and reporting currency

- **Vendor payables** page: what each vendor is owed per currency (waiting for client approval, approved but not billed, on draft bills, due, paid), with totals in your reporting currency. Create bills for one vendor or all, optionally only for completes up to a date.
- **Vendor bills**: one per vendor and currency across projects, a line per project, market and price. Draft → approved (vendor's invoice number, payment terms) → paid (payment reference), or void, which releases the completes. Printable, and shown to the vendor in the portal's new Statements tab once approved.
- **Tax** on client invoices and vendor bills: a default from Settings (for example GST 18% or VAT 20%), changeable on each draft; documents show subtotal, tax and total.
- **Reporting currency and exchange rates** (Settings → Finance, entered by hand; no paid FX feed). The command center's finance and payables tiles add a total in the reporting currency and say which currencies have no rate.
- Details: `docs/PAYABLES.md`.

## Milestone 12: public API and webhooks

- **API keys** (Settings → API and webhooks, admins only): named keys with permissions (projects read/write, sessions, quotas, finance), optional expiry, revoke, last used. The key is shown once; only a hash is stored. 120 requests a minute per key.
- **Public REST API** at `/api/v1/public`: projects with markets, vendor links and session counts, sessions with outcomes, quota cells, client invoices and vendor bills, all paged. Writes: project status and field dates, market status and target, pause or close a vendor link. Writes are recorded as the admin who made the key. OpenAPI description at `/api/v1/public/openapi.json`.
- **Event webhooks**: `session.completed`, `project.status_changed`, `alert.opened`, `invoice.status_changed`, `bill.status_changed`, signed with HMAC-SHA256, retried with backoff, with a delivery log, test ping, secret rotation and "send again".
- Details: `docs/PUBLIC_API.md`.

## Milestone 13: two-step sign-in (MFA)

- **Account security** (account menu, and a shield button in the portals): turn on two-step sign-in with any free authenticator app (Google Authenticator, Microsoft Authenticator, Authy, 1Password) by scanning a QR code. Ten one-time recovery codes, downloadable, can be regenerated.
- **Sign-in** asks for the 6-digit code after the password, or a recovery code. Codes work once; ten wrong codes lock the second step for 15 minutes.
- **Admins** (Settings → Sign-in security) can require it for all staff (portal users stay optional), see who has it on, and reset it for someone who lost their phone. Staff without it can only reach the setup page until they turn it on.
- Secrets are encrypted at rest (`MFA_ENCRYPTION_KEY`). Details: `docs/MFA.md`.

## Milestone 14: scheduled reports by email

- **Reports → Scheduled reports**: email the overall summary or a report by client, vendor, project, country or day, covering yesterday, the last 7 or 30 days, this month so far or last month, optionally for one client, vendor or project.
- Every day, week (pick the day) or month (day 1 to 28) at a local hour in any timezone (default Asia/Kolkata), to up to 20 addresses. The email has headline numbers and the top 25 rows; the full table is attached as CSV. Optionally skip periods with no traffic.
- Preview, send now, pause and resume, and a send history with errors. Admins can send themselves a test email.
- Sent through **Zoho Mail** SMTP, set up in Settings → Integrations (milestone 35). Details: `docs/SCHEDULED_REPORTS.md`.

## Milestone 15: single sign-on with Google, Microsoft and Zoho

- **Sign-in page**: "Continue with Google / Microsoft / Zoho" buttons, shown for each provider set up on the server.
- **Admins** (Settings → Single sign-on): turn each provider on, list the email domains allowed, add the Microsoft tenant ID, and optionally make single sign-on the only way in for staff (admins and portal users keep their password). See and unlink linked accounts.
- Only people already added in SampTrek can sign in; their account links on first sign-in by verified email, then by the provider's account ID. Two-step sign-in still asks for the code.
- Client IDs and secrets are set in Settings → Integrations (milestone 35). Setup steps for Google Cloud, Microsoft Entra and the Zoho API console: `docs/SSO.md`.

## Milestone 16: accounting exports

- **Accounting exports** (`/accounting`): export sent and paid client invoices and approved vendor bills for **Zoho Books**, **Tally Prime** (XML vouchers), **QuickBooks Online**, **Xero** or a general journal CSV, filtered by date, status and currency, with a live preview.
- Documents are marked exported; "only not exported yet" stops double imports. Every file stays in the export history to download again.
- Account names, Xero codes and tax rates, and Tally voucher types and groups are set once by an admin. Tally amounts use the reporting currency and your manual exchange rates. Details: `docs/ACCOUNTING_EXPORTS.md`.

## Milestone 17: quota reallocation suggestions

- **Fieldwork monitor** and the project's **Monitor** tab suggest moving completes away from vendor links that are paused, closed, stalled, behind pace or failing on quality (and any unassigned part of the market target) to live links that can deliver them by the field end date.
- Each move shows why, the receiving link's pace and the CPI change. Untick or reduce moves, then **Apply** changes the vendor targets in one guarded step (never below completes already delivered). Completes nobody can take are shown as still at risk.
- Details: `docs/FIELDWORK_MONITOR.md`.

## Milestone 18: team and password reset

- **Team** (admins, `/settings/team`): invite staff by email with a role, change roles, resend invitations, send reset links, sign someone out everywhere, deactivate and reactivate. Shows status, two-step and single sign-on use, and last sign-in.
- **Forgot password?** on the sign-in page emails a single-use 30-minute link (Zoho Mail SMTP). The same answer for every email; at most 3 per hour per person.
- **Change password** on Account security for staff and portal users. Changing or resetting a password signs out every other session.
- Details: `docs/TEAM_AND_PASSWORDS.md`.

## Milestone 19: payment exports and Zoho Books sync

- **Payment exports** (`/accounting`): payments received and payments made for **Zoho Books**, **Tally Prime** (Receipt and Payment vouchers) and the general journal, filtered by payment date and exported once. The payment reference can now be recorded when an invoice is marked paid, as it already could for bills.
- **Zoho Books sync**: send sent and paid invoices, approved and paid vendor bills, their payments and voids straight into Zoho Books with **Sync now** or every hour. Contacts are found or created per currency, documents keep their numbers and are looked up first so nothing is created twice, and each run lists its problems per document.
- The Zoho self-client credentials are set per organisation in Settings → Integrations (milestone 35). Setup: `docs/ZOHO_BOOKS.md`.

## Milestone 20: AI copilot and voice assistant

- **AI copilot** (`/copilot`, and the sparkle button in the header for a side panel on any page): ask about projects, fieldwork pace, delayed projects, tasks, workload, today's activity, performance reports, invoices, vendor bills and quota reallocation. Answers come from tools that read SampTrek records as the signed-in person, scoped to their organisation and role; tables and charts are built from those records, never by the model.
- **Changes need confirmation**: creating or updating tasks, creating a project, pausing or closing a project or vendor link and running a fieldwork check are shown as cards with Confirm and Cancel. Every proposal, confirmation and result is in the audit log.
- **Documents**: attach a PDF or text file (up to 10 MB) and ask for a summary, requirements or missing information.
- **Voice**: talk to the copilot with Gemini Live (short-lived token, so the API key never reaches the browser; tool calls still run on the server). If Live is not available it falls back to the browser's own speech recognition and speech. Transcripts are saved as conversations.
- **Tasks** (`/tasks`): a minimal tasks module with assignee, project, priority, due date, reminder and one "waits for" dependency. Reminders and overdue tasks show in the notifications bell.
- **Admin controls** (Settings → AI copilot): on/off, which roles may use it, actions, documents, voice, per-person and organisation limits, and usage by day and person.
- Provider-independent gateway; Google Gemini is the first provider. The Gemini API key is set in Settings → Integrations (milestone 35). Setup, models and the free-tier data caveat: `docs/AI_COPILOT.md`.

## Milestone 21: direct sync to Xero, QuickBooks Online and Tally Prime

- **Accounting → Xero, QuickBooks and Tally sync**: send sent and paid invoices, approved and paid vendor bills, their payments and voids straight into Xero, QuickBooks Online or Tally Prime, with **Sync now** or every hour, like the Zoho Books sync.
- Xero and QuickBooks: an admin connects with **Connect** (OAuth, no copying of keys). Tokens are stored encrypted and refreshed as they rotate; an expired sign-in shows **Sign in again**.
- Tally Prime: the server posts vouchers to Tally's XML server (`TALLY_URL`), which must be reachable privately, for example over a VPN.
- Each document is looked up by number before it is created and every created record is remembered, so nothing is sent twice. Runs list their problems per document.
- Setup and the limits of each system: `docs/ACCOUNTING_SYNC.md`.

## Milestone 22: saved report views and PDF export

- **Saved views** (Reports): save the tab, date range and client, project, vendor and market filters under a name. Keep a view to yourself or share it with the team. Relative ranges such as "Last 30 days" move with the calendar. Only the owner or an admin can rename, share or delete a view.
- **Report PDF**: **Download PDF** on the Overall, Clients and Vendors tabs gives a landscape A4 report with the same filters as the screen: total tiles and the grouped table, money per currency.
- **Invoice PDF**: **Download PDF** on each client invoice. The seller block, tax ID and payment details come from Settings → Invoice details; each client's billing address and tax ID are set on the Clients page. Drafts, void and paid invoices carry a stamp.
- **Scheduled report emails** can attach the PDF as well as the CSV.
- Details: `docs/REPORT_VIEWS.md`.

## Milestone 23: project templates, drafts and settings history

- **Templates** (Projects → Templates): save any project as a template, then pick it under **Start from** on Create project. Markets, shared settings, security, questions, page design, autopilot and redirects come with it, and optionally quota cells, vendors, the client and survey links. New vendor entry links are made each time.
- **Drafts**: the Create project form saves itself as you type. Pick up where you left off, or discard a draft.
- **History** tab on every project: each settings change is a version showing who changed what, before and after. **Restore** an earlier version in one click; the restore is a new version and status stays as it is.
- Details: `docs/PROJECT_TEMPLATES.md`.

## Milestone 24: vendor scoring, capacity and suggestions

- **Vendor scores**: every vendor gets a 0–100 score and grade from its traffic: quality rejects, client rejections at reconciliation, delivery against target, incidence against the expected IR, and drop-outs. The Vendors page shows the grade; each vendor has a scorecard with the reasons, a per-market table and recent links.
- **Capacity**: set the completes a vendor can deliver per market a day and a month; see what it already owes on live projects and the room left.
- **Suggested vendors** on each project market: ranked by score, history and capacity in that market and margin on the client CPI, with every reason shown and a CPI and target to start from. Add in one click. The AI copilot can also compare vendors.
- Details: `docs/VENDOR_SCORING.md`.

## Milestone 25: dynamic redirect destinations

- **API destinations**: in hybrid mode a status can be type API. SampTrek asks the client's or vendor's endpoint where to send each respondent (a signed POST with status, UID, vendor, country and project), and sends them to the URL it answers. The endpoint and the answer must be on the allowed domains; a slow, broken or disallowed answer sends the respondent to the rule's fallback URL instead, and it is counted in the bell. QA studio asks the endpoint marked as a test.
- **Scheduled activation**: approve a draft to go live at a set time (for example the start of a new wave). It is checked again when the time comes; if it no longer passes, it stays a draft and the bell says why.
- **Compare versions**: see what changed between any two versions, rule by rule.
- Details: `docs/REDIRECT_DESTINATIONS.md`.

## Milestone 26: portal requests, files and invoices

- **Requests**: clients and vendors ask questions or report problems from their portal; staff answer from Requests (with internal notes, an owner and a status). The other side gets an email through Zoho Mail, and the bell shows what is waiting.
- **Disputes**: a vendor picks completes the client rejected and disputes them; staff approve them or keep them rejected in one click, and the vendor sees the decision.
- **Files**: clients upload questionnaires and download deliverables; staff share files per client or vendor on each project (or keep them staff-only); vendors keep compliance documents with an expiry date, and the bell warns 30 days ahead.
- **Client invoices** in the portal: sent and paid invoices with the PDF.
- Details: `docs/PORTAL_REQUESTS.md`.

## Milestone 27: vendor sign-up and quote requests

- **Vendor sign-up link**: new panel partners apply through a public form, protected by a free maths check, a honeypot and rate limits. Staff approve (creating the vendor, its capacity and an optional portal login with an invite email) or reject from Vendors → Applications.
- **Quote requests**: ask several vendors for CPI and feasibility per market; vendors answer in their portal; staff compare quotes with margin and accept one to create the allocation at the quoted CPI.
- Details: `docs/VENDOR_SIGNUP_QUOTES.md`.

## Milestone 28: converted totals in reports

- Reports show money in the reporting currency by default, converted with the exchange rates in Settings → Finance, or per market currency with one switch. Converted margins work across currencies.
- Currencies without a rate are left out and named. CSV, PDF and scheduled emails carry the converted figures too.
- Details: `docs/REPORT_CURRENCY.md`.

## Milestone 29: command center widgets

- Customize the command center: drag, resize and hide widgets; each person's layout is saved to their account, with reset.
- New widgets: a markets world map, a revenue-to-profit waterfall and a weekday-by-hour traffic heatmap. Key money numbers are now in the reporting currency.
- Details: `docs/DASHBOARD_WIDGETS.md`.

## Milestone 30: data grid and redirect diagram

- A reusable data grid with sortable, resizable and hideable columns, a pinned first column, a sticky header and compact rows. The Projects list uses it, sorted on the server.
- Redirects tab: a diagram of the respondent journey for any market and vendor, from entry link through checks and survey to each outcome's destination and the rule behind it.
- Details: `docs/DATA_GRID_AND_REDIRECT_DIAGRAM.md`.

## Milestone 31: privacy (retention, consent, erasure)

- Settings → Privacy: anonymise finished respondent sessions and delete the event log after a set number of days (runs daily, or Run now). Status, money and counts stay, so reports and invoices do not change.
- Consent notices per market (or one for every market): respondents read and agree on the entry page before the survey; declining ends the session as a partial. The version each respondent agreed to is kept.
- Access and erasure requests: find a respondent by the panel's ID and erase their personal data.
- Details: `docs/PRIVACY.md`.

## Milestone 32: smart forms

- A reusable set of form controls: searchable and multi-select with chips, country (flags) and currency pickers, date pickers that understand "tomorrow" or "+7", date ranges with presets, radio cards, checkbox groups, segmented controls, switches, tags, inline edit, light rich text and drag-and-drop upload. All are keyboard friendly, with accessible errors.
- `SmartForm` draws a whole form from a schema: sections, show-if rules, repeatable groups, validation with an error summary, rule-based suggestions, saved drafts and Ctrl+Enter to submit.
- Used on Add client (with contacts), Add vendor (domains as tags) and client billing details (inline edit). Try every control at Form gallery (`/settings/forms`).
- Details: `docs/SMART_FORMS.md`.

## Milestone 33: white-labelling

- Settings → Branding: product name, tagline, logo (light and dark), icon, default theme and brand colour, sign-in message, support email, and the option to hide "Powered by". Every page, portal and email follows the brand, including the browser tab and authenticator app entries.
- Emails use your sender name and reply-to address, and keep the server's own address so they still pass spam checks.
- Custom domain checked by DNS (CNAME plus a TXT token). After the check, emails link there and sign-in pages on that address show your brand. Operations add TLS and build the web app with `NEXT_PUBLIC_CUSTOM_DOMAINS=true`.
- White-labelling itself has no billing; feature plans are managed by the Super Admin (see below). Details: `docs/WHITE_LABEL.md`.

## Milestone 34: redirect health

- A Redirect health page (`/redirect-health`) for all projects or one, over the last hour, 24 hours or 7 days:
  - each project labelled healthy, watch or failing, with the reasons;
  - redirects over time, and the share that fell back and why;
  - redirect times;
  - respondents who never came back from the survey;
  - vendor callbacks by host, with "Send again" for ones that gave up.
- "Check survey links" opens every live client survey link once and reports broken, missing or slow links. It never reaches private networks.
- Details: `docs/REDIRECT_HEALTH.md`.

## Milestone 35: every integration set up in the app

- **Settings → Integrations** (`/settings/integrations`, admins): email sending (Zoho Mail SMTP), sign in with Google, Microsoft and Zoho, the Gemini AI copilot, Zoho Books, Xero, QuickBooks Online, Tally Prime and the Bidzo link, all set up on screen. No server files to edit.
- Each card has step-by-step help with links to where every key comes from, the redirect URI to copy, **Save and test**, and a status: Connected, Server settings, Check settings or Not set up.
- Zoho Books needs no curl: paste the grant code and SampTrek gets the refresh token and finds the organisation.
- Secrets are encrypted at rest, never shown again and never written to the audit log. Old environment variables still work as a fallback, so existing servers keep running.
- Only five values stay on the server (database, session key, master encryption key, the two addresses). Details: `docs/INTEGRATIONS.md`.

## Milestone 36: project from a brief

- Projects → From a brief (or Create project → Read a brief). Attach a client brief or RFQ (PDF, image or text) or paste it, and the AI fills the Create project form: name, client, category, markets with completes, LOI, incidence, CPI, currency, fieldwork dates, devices, target group, and quotas and notes in the description.
- A banner shows what was filled, what the brief leaves out, warnings, and quotes showing where each key value came from. Every value is checked against the form's limits. Nothing is created until you press Create.
- Create project now has fieldwork dates.
- Details: `docs/PROJECT_FROM_BRIEF.md`.

## Product tour

- After signing in, staff get a short guided tour that highlights each main feature on the real screen: command center, search, projects, create project, won bids, fieldwork monitor, redirect health, reports, invoices and payables, clients and vendors, portals, tasks, AI copilot, alerts, settings and Theme Studio.
- **Start tour**, **Remind me later** (shows again at the next sign-in) or **Skip tour**. Skip, Esc and Finish are remembered per person on the server, so it does not come back on another device.
- Replay it any time from the account menu (Take the product tour) or Ctrl K → "tour". Steps follow the person's role, and on phones the menu opens for sidebar steps.
- Details: `docs/PRODUCT_TOUR.md`.

## Milestone 38: one-time unique links

- Project → **Unique links**: generate any number of respondent links (up to 50,000 at a time) for a vendor in a market. Each link has its own random key: `/u/{key}`.
- A link works once. The first respondent to open it enters the survey; any later visit, a second tab or simultaneous clicks are turned away as Duplicate. This is enforced by one guarded database update, not by the browser. Links opened while fieldwork is paused are not used up.
- See every key with its status (Unused, Used, Expired, Revoked) and the respondent's outcome, filter and search, download as CSV, revoke unused links, set an expiry per batch.
- **Unique links only** per vendor and market closes the shared vendor link. Vendors can download their unused links in the vendor portal.
- Details: `docs/UNIQUE_LINKS.md`.

## Mobile app for Android and iOS

`apps/mobile` is one Expo (React Native) app for Android and iOS in the Neon (dark) and Aurora (light) looks from the design mockups. Staff get the command center, projects (with markets, vendors, quotas, share links, go live / hold / close, pause vendors), fieldwork monitor and alerts, AI copilot with confirm cards, tasks, requests, won bids, reports, invoices, vendor payables, clients, vendors, redirect health and notifications; client and vendor users get their portal. Settings-heavy screens open the web app. What each person sees follows the Super Admin feature switches for mobile and changes live (next API call, opening More, returning to the app, or within 30 seconds). Contract, store builds with EAS and limits: [docs/MOBILE_APP.md](docs/MOBILE_APP.md).

## Super Admin, subscriptions and feature control

- **Super Admin** (the person who runs the server) above every organisation's admins: register and approve organisations, pause or reactivate them, and see everything at a glance.
- **Plans**: feature packages for the web and the Android/iOS app, with user and project limits and monthly/yearly prices that organisations pay online (Razorpay, Stripe) or offline (bank, UPI, cheque; Super Admin confirms) in Settings → Subscription (docs/SUBSCRIPTION_PAYMENTS.md). Each organisation gets a subscription: trial, active, past due, expired or cancelled, with dates.
- **Any feature on or off** for one organisation, or one person, separately on the web and in the mobile app. The API enforces it on every request and sends `X-Features-Version`, so the web app and the mobile app change within seconds. `GET /auth/me/features` is the contract both apps read.
- **Activity** of every admin and user in every organisation, including sign-ins; **Integrations** of every organisation: allow, block, see test results, remove settings.
- **Automation**: plain When / Only if / Then rules (registrations, trials and renewals ending, subscriptions ended, inactive organisations, user limits, failing integrations → emails, tasks, approvals, plan and status changes, pause, feature switches) with ten one-click recipes.
- Public registration page `/register` (opened by the Super Admin).
- Details: `docs/SUPER_ADMIN.md`.

## Install on a server

See `INSTALL.md`: server settings, database, `pnpm create-admin` for the first admin, build, run and TLS.

## Run it locally

Requirements: Node 26 (LTS, see `.nvmrc`), pnpm 10 (`npm install -g pnpm@10.28.0`), PostgreSQL 16 (or Docker).

```bash
docker compose up -d                 # Postgres + Redis (or use your own Postgres)
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
pnpm install
pnpm db:migrate                      # create the schema
pnpm db:seed                         # synthetic demo data
pnpm dev                             # API on :4000, web on :3000
```

Sign in at http://localhost:3000 with `pm@projexa.local` or `admin@projexa.local`, password `projexa-demo-2026` (set `SEED_ADMIN_PASSWORD` to change it). Portal demo logins: `client@projexa.local` (Acme Insights) and `vendor@projexa.local` (Panel Alpha), same password. The demo project has US, GB and DE with two vendors and a hybrid redirect setup that points at local mock survey and vendor pages, so you can open a test link from the QA studio and click through a full respondent journey.

## Tests

```bash
createdb projexa_test                # once; or set TEST_DATABASE_URL
pnpm --filter @projexa/api test      # unit + e2e (uses the *_test database only)
pnpm --filter @projexa/web typecheck
```

## Layout

```
apps/api   NestJS API, Prisma schema and migrations, tests
apps/web   Next.js web app (App Router, Tailwind)
apps/mobile Expo app for Android and iOS (npm, outside the pnpm workspace)
docs/      Phase 0 documents and integration guide
```


## Neon Command design

The web CRM's default look (violet and blue glass, indigo navigation, lifecycle command center). Other themes remain in Theme Studio. See [docs/NEON_DESIGN.md](docs/NEON_DESIGN.md).

## Data processing and analytics

Two Fieldwork pages from the mockup, per project and from real data: **Data processing** (pipeline from intake to billing, validation, cleaning by vendor, quota balance, clean data CSV) and **Analytics** (KPIs, charts, crosstabs, answer analysis, rule-based insights, deliverables). Super Admin features `data_processing` and `analytics`. See [docs/DATA_PROCESSING_AND_ANALYTICS.md](docs/DATA_PROCESSING_AND_ANALYTICS.md).

## Sampledge logo on respondent pages, notification reads, audience question sets

- **Respondent pages** show the SampTrek by Sampledge logo and tab icon (gate and every end page); a project's own logo moves it to a "Powered by" line, and Respondent pages → Show the Sampledge logo turns it off. See [docs/BRAND.md](docs/BRAND.md).
- **Notifications**: opening the bell marks alerts read for that person; the badge counts only new ones. See [docs/NOTIFICATIONS.md](docs/NOTIFICATIONS.md).
- **Audience sets** in the gate survey builder: B2B, B2C, parents, teens, healthcare consumers, patients and caregivers; every question stays editable and organisations can save their own version. See [docs/GATE_QUESTION_SETS.md](docs/GATE_QUESTION_SETS.md).
