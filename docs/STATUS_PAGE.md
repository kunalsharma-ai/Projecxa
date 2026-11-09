# Status page and uptime (/status, Super Admin → Status page)

A public page at **`/status`** on the web app shows whether SampTrek is working, the last **90 days of
uptime** for each part, and any incident or planned maintenance the Super Admin posts. Anyone can open it
without signing in: clients, vendors and staff. It shows nothing about organisations, projects or people.

## What is measured

The API checks itself **every minute** and stores the result (`UptimeCheck`):

| Part | Working | Slow or partly working | Not working |
| --- | --- | --- | --- |
| Website and API | The check ran | – | No check (server off) |
| Respondent links and redirects | Database answers | Database slow | Database down |
| Database | `SELECT 1` under 1.5 s | Slower | Fails |
| Vendor callbacks and webhooks | Normal | 50 or more callbacks waiting over 15 minutes | Database down |
| Email sending | Normal | The server owner's last email test failed | Database down |

**A minute without a check counts as down**, so the time the server was off or restarting shows as
downtime. Days before the first check show as "no data". Degraded minutes count as up in the uptime %
but colour the day yellow. Checks older than 90 days are deleted.

Each day is a bar: green (99.9 % or more), yellow (below 99.9 %, or more than 30 slow minutes), red
(below 99 %), grey (no data). Hover a bar for the minutes down.

Because the server checks itself, it cannot report while it is completely off: the page then says
"SampTrek is not answering". For alerts in that case, add the **ping address**
`https://<api>/api/v1/public/status/ping` to a free outside monitor (UptimeRobot, Better Stack). It
answers 200 when the API and database work and 503 when the database does not.

## Super Admin → Status page

- **Page settings**: publish or hide the page, title, introduction, and which parts to show.
- **Links to share**: the page address and the ping address, with copy buttons.
- **Post an incident or maintenance**: what happened, impact (*some things slow or failing*, *down for
  many people*, *planned maintenance* with start and end), the parts affected and a message for people.
- **Open incidents**: post updates and move through *Investigating → Cause found → Fixed, watching →
  Resolved* (maintenance: *Scheduled → In progress → Completed*). Each update is kept and shown.
- **Preview** of the page as people see it, also while it is not published. **Check now** takes a check.

How incidents change the page: an open *major* incident shows its parts as **not working** and the top
banner red; a *minor* one makes them yellow; maintenance *in progress* shows blue; *scheduled*
maintenance is listed under the banner without changing any colour. Closed incidents stay listed for
14 days.

The public data is cached for 30 seconds and the page refreshes every minute.

## API

| Method | Path | Who |
| --- | --- | --- |
| GET | `/api/v1/public/status` | Anyone (404 when not published) |
| GET | `/api/v1/public/status/ping` | Anyone; 200 or 503 |
| GET | `/api/v1/super-admin/status` | Super Admin: settings, preview, incidents, last check |
| PUT | `/api/v1/super-admin/status/settings` | `{ enabled, title, intro, components }` |
| POST | `/api/v1/super-admin/status/check` | Take a check now |
| POST | `/api/v1/super-admin/status/incidents` | `{ title, impact: minor|major|maintenance, state?, components, message, startsAt?, endsAt? }` |
| PATCH | `/api/v1/super-admin/status/incidents/:id` | Change state, add an update `{ state, message }`, edit fields |
| DELETE | `/api/v1/super-admin/status/incidents/:id` | Remove |

`STATUS_CHECKS_ENABLED=false` stops the minute checks on a server (tests do this). Code:
`apps/api/src/status/status.service.ts`, page `apps/web/app/status/page.tsx`.
