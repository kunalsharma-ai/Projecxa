# Vendor auto-routing

Route traffic to the best vendor automatically. When a live market will fall short, SampTrek moves
the completes a vendor link will not deliver to the best other link in that market, by changing
vendor targets. It builds on [quota reallocation](FIELDWORK_MONITOR.md) (which finds the at-risk
completes and the links with room) and [vendor scoring](VENDOR_SCORING.md) (which says which vendor
is best).

Vendors send their own traffic to their entry links, so "routing" means raising the target of the
best link (and lowering the one that will not deliver). Vendors see their new target in the vendor
portal straight away.

## Switching it on

Project → Quotas & monitor → Autopilot → **Route traffic to the best vendor**. It is off by default
and is set per project. Saved in `Project.autopilot.autoRoute` (`autoRouteSchema` in
`apps/api/src/monitor/monitor.rules.ts`):

| Setting | Default | Meaning |
| --- | --- | --- |
| `enabled` | off | Turns routing on for this project. |
| `mode` | `approve` | `approve`: the plan is shown, someone presses **Route**. `auto`: the monitor applies it every five minutes. |
| `weights` | score 50, cost 30, room 20 | How much each part of the routing score counts. They do not need to add up to 100. |
| `minScore` | 55 | Vendors scoring under this never receive routed completes (C grade starts at 55). |
| `keepMargin` | on | Never route to a link whose CPI is at or above the client CPI. |
| `maxMovePercent` | 25 | At most this share of what the market still needs moves in one run; the rest waits for a later run. |
| `cooldownHours` | 6 | After a run or an undo, the autopilot leaves that market alone this long. |

## How a plan is made

`planRoute()` in `apps/api/src/monitor/routing.ts`, pure and unit-tested (`test/unit/routing.spec.ts`):

1. **What is at risk.** The reallocation suggestions find the donors: paused, closed, stalled or
   low-quality links, links behind pace for the field end date, and market target no link has. Only
   what the market is actually short is freed.
2. **Who can receive.** Live links with room (what they can still deliver by the field end date at
   their pace; about three days of pace when there is no end date).
3. **Who never receives.** Vendor score under `minScore`, or CPI at or above the client CPI when
   `keepMargin` is on. These are listed as *Skipped* with the reason.
4. **Ranking.** Each remaining link gets a routing score, the weighted average of three 0–100 parts:
   - **score**: the vendor score over the last 180 days, in this country when it has enough data
     (30 clicks), otherwise overall. A vendor with no score yet counts as 60.
   - **cost**: margin `(client CPI − vendor CPI) / client CPI`, as a percentage.
   - **room**: the link's room against the largest room in the market.
   Ties go to the cheaper link, then the one with more room.
5. **Moves.** Largest donor first, best link first, each up to its room, all within the per-run cap.
   Completes held back by the cap are shown as *held*; completes nobody has room for are *uncovered*
   (add a vendor, raise CPI, or move the field end date).

Every number is returned, so the screen shows the ranking table, each vendor's parts, the CPI change
per move and the total change in vendor cost.

## Applying and undoing

- `GET /projects/:id/routing`: settings, a plan per live market (with `key`, the plan's moves as a
  string), the autopilot's wait (`cooldownUntil`) and the last 20 runs.
- `POST /projects/:id/countries/:countryId/route` `{ key }` (editors): applies the plan. The server
  recomputes the plan and refuses with 409 if it is no longer the one the person saw.
- `POST /projects/:id/routing/runs/:runId/undo` (editors): puts every vendor target of the run back.
  It refuses with 409 if any of those targets changed since, so a newer change is never overwritten.
  A target never goes below the completes the link already has.
- Auto mode: `MonitorService.evaluate()` calls `RoutingService.runAuto()` right after the auto-pause
  checkpoints, for live markets of projects in `auto` mode that are outside their cooldown. Its runs
  have `trigger = auto` and no actor, and show as "SampTrek autopilot".

Target changes go through `applyMoves()` (`apps/api/src/monitor/apply-moves.ts`), the same guarded
transaction as manual reallocation: each target is checked against the value that was read, and the
routing run is written in the same transaction.

Each run is a `RoutingRun` row: the moves, each target before and after (used by undo), the
explanation (ranking, skipped, settings, cap, held, uncovered, cost change) and a one-line summary.
Audit actions: `allocation.route` (by hand), `autopilot.route` (automatic), `allocation.route_undo`.

## Screens

- Autopilot card: the switch and settings.
- **Vendor routing** card (above Reallocation suggestions): one plan per market with **Route**, the
  ranking table and skipped vendors, then **Routing history** with **Undo**.
- Help entries: `project.autoRoute`, `project.autoRoute.weights`, `project.routingPlan`,
  `project.routingHistory` in `apps/web/lib/help.ts`.
