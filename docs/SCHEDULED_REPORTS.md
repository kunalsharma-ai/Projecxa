# Scheduled reports by email

> **Now set up in the app.** Each organisation enters its Zoho Mail SMTP settings in **Settings → Integrations** (see `docs/INTEGRATIONS.md`). The environment variables are an optional fallback.

Milestone 14. Reports are emailed on a schedule through the company's **Zoho Mail** account.
Each email has the headline numbers and the top 25 rows; the full table is attached as a CSV.

## Using it

**Reports → Scheduled reports** (`/reports/schedules`). Admins and project managers create and
change schedules; everyone on staff can see them, preview them and read the send history.

| Setting | Choices |
|---|---|
| Report | Overall summary (rows by project, busiest first), by client, by vendor (vendor and market), by project, by country, by day |
| Covers | Yesterday, last 7 days, last 30 days, this month so far, last month. Worked out in the schedule's timezone when it is sent |
| Filters | Optional client, vendor and project |
| When | Every day, every week on a chosen day, or every month on day 1 to 28, at a whole hour in any timezone (default Asia/Kolkata) |
| Send to | Up to 20 addresses. Anyone listed gets the figures, including revenue |
| Skip empty | Do not send when the period had no respondent traffic (recorded as skipped) |

Buttons: **Preview** (the email as it would look now), **Send now** (same recipients, period as
of now; does not move the schedule), **History** (last 50 sends with errors), pause and resume,
edit, delete. Admins also get **Send me a test email** to check the mail settings.

The numbers are the same as the Reports screens: test traffic is never counted, money stays in
each market's currency (the email adds currencies side by side, never converted), and the CSV
has one line per row and currency. The days covered are the schedule's local days applied to the
report's UTC day boundaries, the same way the Reports screens filter dates.

## How sending works

- A scheduler in the API checks every minute. A due schedule is claimed by moving its next send
  time forward with a guarded update, so running several API instances never sends twice.
- If the server was down at send time, the schedule sends once when it comes back, not once per
  missed slot. Resuming a paused schedule starts from the next slot after now.
- Mail problems never stop the scheduler: the send is recorded as failed with the reason
  (for example "535 Authentication Failed") and the schedule moves on to the next slot.
- CSV cells that start with `=`, `+`, `-` or `@` are prefixed with `'` so spreadsheet apps do
  not run them as formulas.
- `REPORT_SCHEDULER_ENABLED=false` turns the scheduler off (tests do this).

## Setting up Zoho Mail

The SMTP settings live only in the API's environment. They are never stored in the database
or shown on screen.

1. In Zoho Mail, pick (or create) the mailbox that sends reports, for example
   `reports@yourcompany.com`.
2. Create an **application-specific password** for it: Zoho Accounts → Security → App
   Passwords (needed when two-factor sign-in is on, and recommended anyway).
3. Make sure SMTP access is allowed for that mailbox: Zoho Mail → Settings → Mail Accounts →
   IMAP/POP/SMTP access.
4. Set these on the API server and restart it:

```
SMTP_HOST=smtp.zoho.com        # smtp.zoho.in for India, smtp.zoho.eu for EU accounts
SMTP_PORT=465                  # SSL; or 587 with SMTP_SECURE=false (STARTTLS)
SMTP_USER=reports@yourcompany.com
SMTP_PASS=<the app-specific password>
MAIL_FROM="PROJEXA Reports <reports@yourcompany.com>"
```

`MAIL_FROM` must be the same mailbox or an alias Zoho lets it send as. Use the host for the data
centre your Zoho account is in (the domain you sign in at: zoho.com, zoho.in, zoho.eu). Then use
**Send me a test email** on the Scheduled reports page.

Zoho Mail limits how much one mailbox sends per day. Scheduled reports are small in number, but
if volume grows a lot, Zoho ZeptoMail (Zoho's transactional email service) also speaks SMTP:
point `SMTP_HOST`, `SMTP_USER` and `SMTP_PASS` at it without code changes.

## API

| Method | Path | Who |
|---|---|---|
| GET | `/report-schedules` | Staff: schedules, mail status, report and period choices |
| POST | `/report-schedules` | Admin, PM |
| PUT | `/report-schedules/:id` | Admin, PM (full replace; recomputes the next send) |
| PATCH | `/report-schedules/:id` `{ active }` | Admin, PM |
| DELETE | `/report-schedules/:id` | Admin, PM |
| POST | `/report-schedules/:id/send` | Admin, PM |
| GET | `/report-schedules/:id/preview`, `/runs` | Staff |
| POST | `/report-schedules/test-email` | Admin |

## Code

`apps/api/src/schedules/schedule.rules.ts` (timezones, next send, periods, validation),
`report-email.ts` (email and CSV), `schedules.service.ts` (scheduler and endpoints),
`apps/api/src/mail/mail.service.ts` (SMTP). Web: `apps/web/app/(app)/reports/schedules/page.tsx`.
Tests: `test/unit/schedule-rules.spec.ts`, `test/e2e/schedules.e2e.spec.ts`.
