# Profit forecast: finish date, cost and margin

While a project is live, SampTrek predicts when it will reach its targets and the money it will end with, from its current pace and vendor mix. It raises a **margin_low** alert when the predicted margin drops too low.

## Where it shows

- **Project page → Forecast at finish**, under the live revenue, cost and profit. Tiles: Finish date, Revenue at finish, Cost at finish, Profit at finish and Margin vs plan (per CPI currency), a confidence chip, and a **By market** table. A warning strip appears when the margin is low. It refreshes with the page every 30 seconds.
- **Monitor** and **Quotas & monitor → Active alerts**: the margin alert, with the push notification, webhook and `alert.opened` event every alert gets.
- API: `GET /api/v1/monitor/forecast?projectId=` returns `{ forecast, reason }`. `forecast` is null (with a `reason`) when the project is not live or has no live or held market.

## How it is worked out

Code: `apps/api/src/monitor/forecast.ts` (pure functions, unit-tested in `test/unit/forecast.spec.ts`), fed by `MonitorService.forecasts()`.

Per market (live and held markets of a live project):

| Figure | Formula |
| --- | --- |
| Per day | Completes of the last 72 hours ÷ 3 (or ÷ the real age when fieldwork is younger), the same pace as the fieldwork monitor. |
| Finish | Now + completes to go ÷ per day. None when nothing came in for 72 hours. |
| Cost per remaining complete | Payout of the ACTIVE vendor links that still have completes to deliver, weighted by each link's pace; without pace, by what each link still has to deliver; then the average payout so far; then the average payout of all the market's links. The By market table names which one was used. |
| Revenue at finish | Revenue so far + completes to go × client CPI. |
| Cost at finish | Payout so far + completes to go × cost per remaining complete. |

Per project: the finish date is the latest market finish (unknown while any open market has no pace) and **days late** counts days past the field end date. Money is totalled per CPI currency; closed markets count with what they earned and cost and add nothing more. **Planned margin** uses the bid: client CPI × target against the average vendor payout × target, the same as Expected revenue on the project page.

Confidence is **low** under 10 completes or with a market of unknown pace, **medium** under 50 completes or when a market is priced at the average vendor payout, **high** otherwise.

## Margin alert

One alert per project and currency (`dedupeKey p:<projectId>:<currency>:margin_low`). It waits for 5 completes in that currency, then fires when the forecast margin is:

- under the **margin floor**: `marginFloorPct` in Settings → Fieldwork alerts (default 20%), or the project's own floor in **Quotas & monitor → Autopilot → Margin alert below (%)** (`autopilot.marginFloorPct`, 0–95, empty uses the organisation's); or
- `marginDropPts` points or more under the planned margin (default 10).

It is a warning, or critical when the project is heading for a loss, and it clears by itself once the forecast recovers. The project floor is part of the autopilot, so it is in the settings History and copied by Clone project and templates.

## Help text

`apps/web/lib/help.ts`: `project.forecast`, `field:Margin alert below`, `field:Margin floor`, `field:Margin drop`.
