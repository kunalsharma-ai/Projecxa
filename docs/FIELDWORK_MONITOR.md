# Fieldwork monitor and autopilot

The fieldwork monitor watches every live market and vendor link, works out whether it will finish on time, and raises alerts when something needs a project manager. Autopilot can take two safe actions on its own.

## Where to find it

- **Fieldwork monitor** (`/monitor`, in the sidebar): summary tiles, active and resolved alerts, and a table of live markets. Expand a market to see its vendor links and pause or reactivate them.
- **Project → Quotas & monitor tab** (the Quotas and Monitor tabs merged; old `?tab=quotas` and `?tab=monitor` links open it): quota cells first, then field start and end dates, autopilot switches, and this project's alerts and markets.
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
| margin_low | warning, or critical when the forecast is a loss | A live project's forecast margin at finish is under `marginFloorPct` (20%, or the project's own `autopilot.marginFloorPct`), or `marginDropPts` (10) points under the planned margin, after 5 completes in that currency (docs/PROFIT_FORECAST.md) |

Defaults are in brackets. Admins change them in Settings (`PUT /api/v1/organization/alert-settings`).

## Autopilot

Off by default, per project (`autopilot` on `PATCH /projects/:id`):

- `pauseOnQuality`: pause a vendor link when it triggers `quality_spike`.
- `closeOnTarget`: close a vendor link once it delivers its target.

Every action is written to the audit log (`autopilot.pause_link`, `autopilot.close_link`, no actor) and shown on the alert. Autopilot never reactivates a link; a person does that from the monitor.

### Auto-pause at a checkpoint (soft launch)

`autopilot.autoPause = { enabled, by: 'percent' | 'completes', value, scope: 'market' | 'vendor' }`:

- **When**: at `value`% of the target (1–99, rounded up, at least 1 complete) or at `value` completes. A checkpoint at or past the target never fires.
- **What**: `market` puts each market on hold (`ProjectCountry.status = HOLD`); `vendor` pauses each vendor link on its own target.
- **How fast**: checked right after every live complete (`src/monitor/auto-pause.ts`, called by the survey engine) and on every monitor run, so it acts on the complete that reaches the checkpoint.
- **Once each**: what happened is stored server-side in `Project.autopilotState.autoPause.done` (`m:<marketId>` / `a:<allocationId>`, reason `paused` or `target`). After someone resumes a market or link it is never paused again by the same checkpoint; a market or link that reaches its target is marked done without pausing.
- **Switches itself off**: when every open market or link is done, the autopilot sets `autoPause.enabled = false` and records `switchedOffAt` (audit `autopilot.auto_pause_off`). Switching it on again, or changing the checkpoint, starts afresh.
- **Alert**: while a market or link stays paused at the checkpoint, the monitor shows an info alert `auto_paused`; it resolves when someone resumes it. Audit: `autopilot.pause_market` / `autopilot.pause_link`.

## Reallocation suggestions

The monitor page and the project's Monitor tab show **Reallocation suggestions**: for each live market, which vendor links will not deliver their remaining completes and which links have room to take them. Nothing changes until an editor applies them.

Completes are freed from:

| Reason | What is freed |
|---|---|
| Paused or closed link | Everything it still has to deliver |
| Quality problems | Everything left, when `qualityPct` of its last-24h entries were rejected (at least 10 entries) |
| Stalled | Everything left, when it had no entries for `stalledHours` |
| Behind pace | What it will not reach by the field end date at its current pace (per day × days left) |
| Not given to any vendor | The part of the market target that no link's target covers |

A link that has not had a single entry yet is left alone (it may not have launched).

Completes go to live links without quality problems that have room: with a field end date, what they can deliver by then beyond their own remaining target; without one, about three days of their current pace. The cleanest quality comes first, then the fastest, then the lowest CPI. The table shows the CPI change per complete for each move.

What no link can take is shown as **still at risk**: add another vendor, raise CPI, or move the field end date.

**Apply** (admins and project managers) changes the vendor targets in one go. Each move can be unticked or reduced first. A target never goes below the completes a link already has, completes only go to active links, and if targets changed in the meantime nothing is applied and the screen asks to refresh. The change is audit-logged as `allocation.reallocate`. Vendors see their new target in the vendor portal.

API: `GET /monitor/reallocation?projectId=` (staff) and `POST /projects/:id/countries/:countryId/reallocate` `{ moves: [{ from: allocationId | null, to: allocationId, completes }] }` (admin, project manager).

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
| GET | `/monitor/forecast?projectId=` | staff |
| POST | `/monitor/run` | admin, project manager |
| GET | `/alerts?state=ACTIVE\|OPEN\|ACKNOWLEDGED\|RESOLVED&projectId=` | staff |
| POST | `/alerts/:id/acknowledge`, `/alerts/:id/resolve` | admin, project manager |
| GET / PUT | `/organization/alert-settings` | admin |
| POST | `/organization/alert-settings/rotate-secret`, `/organization/alert-settings/test` | admin |
