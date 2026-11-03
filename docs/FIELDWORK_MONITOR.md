# Fieldwork monitor and autopilot

The fieldwork monitor watches every live market and vendor link, works out whether it will finish on time, and raises alerts when something needs a project manager. Autopilot can take two safe actions on its own.

## Where to find it

- **Fieldwork monitor** (`/monitor`, in the sidebar): summary tiles, active and resolved alerts, and a table of live markets. Expand a market to see its vendor links and pause or reactivate them.
- **Project → Monitor tab**: field start and end dates, autopilot switches, and this project's alerts and markets.
- **Settings → Fieldwork alerts** (admins): thresholds and the alert webhook.
- **Command center insights** show open warning and critical alerts.

## How it runs

The API checks every organisation with live projects or open alerts every five minutes (`MONITOR_ENABLED=true`, the default). Editors can run it at once with **Check now** (`POST /api/v1/monitor/run`).

Each check:

1. Counts sessions per market (project country) and per vendor link for live projects.
2. Works out pace and evaluates the rules below.
3. Opens a new alert, or updates the open one with the same key, so one problem is one alert.
4. Resolves alerts whose condition has cleared ("Cleared by itself").
5. Posts new alerts to the webhook, if one is set.

An alert can be **acknowledged** (someone is on it) or **resolved** by hand. If a hand-resolved problem is still true, the next check opens a new alert.

## Pace

- **Per day**: completes in the last 72 hours divided by 3 (or by the age of the market if it is younger).
- **Needed per day**: completes left divided by days to the field end date.
- **Status**: done, on track (per day ≥ needed), slightly behind (≥ 80% of needed), behind, overdue (past the end date), stalled (no entries for the stalled window), not started, or no end date.

## Rules

| Rule | Level | Fires when |
|---|---|---|
| stalled | warning | A live market has had no entries for `stalledHours` (24) |
| behind_pace | warning, or critical when overdue | Pace status is behind or overdue |
| low_ir | warning | Actual IR is `irDropPct` (30%) below planned, after `minSample` (20) decided respondents |
| loi_short | critical | Median complete LOI under `loiShortPct` (40%) of planned (possible speeders) |
| loi_long | warning | Median complete LOI over `loiLongPct` (150%) of planned |
| quota_near | info | Market at `quotaNearPct` (90%) of target |
| target_reached | info | Market or vendor link reached its target |
| cell_full | info | An open quota cell reached its target (docs/QUOTAS.md) |
| quality_spike | critical | A vendor link has `qualityPct` (25%) of its last-24h entries rejected for quality, duplicates or security |
| drop_off | warning | A vendor link has `dropOffPct` (30%) of its last-24h entries dropping out |
| callbacks_failed | warning | Outbound vendor callbacks have failed |

Defaults are in brackets. Admins change them in Settings (`PUT /api/v1/organization/alert-settings`).

## Autopilot

Off by default, per project (`autopilot` on `PATCH /projects/:id`):

- `pauseOnQuality`: pause a vendor link when it triggers `quality_spike`.
- `closeOnTarget`: close a vendor link once it delivers its target.

Every action is written to the audit log (`autopilot.pause_link`, `autopilot.close_link`, no actor) and shown on the alert. Autopilot never reactivates a link; a person does that from the monitor.

## Alert webhook

Set an HTTPS URL in Settings. The signing secret is shown once when the webhook is first saved or the secret is rotated.

Each new alert is sent as:

```http
POST <your url>
Content-Type: application/json
X-Projexa-Timestamp: 1793563200
X-Projexa-Signature: sha256=<hex HMAC-SHA256 of "<timestamp>.<raw body>" with your secret>

{"event":"alert.opened","alert":{"id":"…","rule":"behind_pace","severity":"warn","title":"PRX10001 US is behind pace","detail":"…","project":{"projectCode":"PRX10001",…},…},"link":"https://app.example.com/monitor"}
```

Verify the signature over the raw body and reject timestamps older than five minutes. **Send test** posts an `alert.test` event. The HTTP status (or error) of each delivery is stored on the alert; delivery is not retried.

## API

| Method | Path | Who |
|---|---|---|
| GET | `/monitor?projectId=` | staff |
| POST | `/monitor/run` | admin, project manager |
| GET | `/alerts?state=ACTIVE\|OPEN\|ACKNOWLEDGED\|RESOLVED&projectId=` | staff |
| POST | `/alerts/:id/acknowledge`, `/alerts/:id/resolve` | admin, project manager |
| GET / PUT | `/organization/alert-settings` | admin |
| POST | `/organization/alert-settings/rotate-secret`, `/organization/alert-settings/test` | admin |
