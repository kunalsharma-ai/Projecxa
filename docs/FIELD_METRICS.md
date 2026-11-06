# Live field metrics: Avg LOI, Avg IR, speeders and money

What the project page, the project list and the reports show while fieldwork runs, and the speeder check that feeds them.

## Avg LOI and Avg IR

| Figure | Formula | Where |
| --- | --- | --- |
| **Avg LOI** (reports: **LOI**) | Mean minutes from survey start to complete, over live (non-test) completes. Survey start is when the gate page released the client survey link (`gatePassedAt`), or entry when there is no gate, so our own checks never count. | Project header and fieldwork status, market table (under the planned LOI), project list column, reports (tiles, tables, CSV, PDF, scheduled email). |
| **Avg IR** (reports: **IR**) | Completes ÷ (completes + terminates), in percent. Quota full, speeders and other quality fails are left out. | Same places. |

The planned LOI and IR (from the bid, per market) stay on each market and are shown beside the actual figures. The project list shows the actual value with “plan …” under it, and colours an IR more than 30% below plan.

Code: `apps/api/src/projects/field-metrics.ts` (`fieldMetrics()` runs one grouped query for a page of projects or per market). API: `GET /projects` rows carry `avgLoiMinutes`, `avgIrPercent`, `speeders` (and the planned `loiMinutes`, `irPercent`); `GET /projects/:id` carries `metrics` and `countries[].metrics`; report rows carry `loiMinutes`, `ir` and `speeders` (`medianLoiMinutes` is kept for older clients).

## Speeder check

Set per project in **Gate & security → Speeder check** (or `speederCheck` on create and `PATCH /projects/:id`):

```json
{ "speederCheck": { "enabled": true, "fraction": "1/3" } }
```

- Presets 1/4, 1/3, 2/4, 2/3, 3/4; any fraction n/d with 1 ≤ n < d ≤ 10 is accepted.
- A complete whose survey time is below `fraction × the market's planned LOI` becomes `QUALITY_FAIL` with `statusDetail = SPEEDER`. It takes no quota, earns no revenue and owes no payout; the respondent goes to the quality-fail destination and the vendor callback says quality fail.
- A later server-to-server `complete` for a speeder is answered `200` with `status: QUALITY_FAIL` (not a conflict), the same as an overquota.
- Test links are checked too, so QA can try it.
- The setting is in the settings History (restorable), copied by Clone project.

Speeders are counted on their own: `stats.SPEEDER` on the project and vendor links (and left out of `stats.QUALITY_FAIL`), a **Speeders** tile in the fieldwork status, a **Speeders** column in the project list and reports, and the reason “Speeder” on the Respondents tab and in Gate & security → What the checks caught. The vendor portal filter `status=SPEEDER` lists them. The report PDF keeps one “Quality” column that includes speeders.

## Live revenue, cost and profit

The project page shows, per CPI currency, **Revenue (live)** (client CPI × completes), **Cost (live)** (vendor payout for those completes) and **Profit (live)** with the margin, next to the client CPI and the expected revenue at target. A live project refreshes its counts, Avg LOI / Avg IR and money every 30 seconds while the page is visible (only the figures, so open forms keep their input). Rejected completes leave the money once they are reconciled.

## Help text

All words for the “i” icons are in `apps/web/lib/help.ts`: `project.fieldStatus`, `project.liveMoney`, `project.speederCheck`, `project.autoPause`, `field:Avg LOI`, `field:Avg IR`, `field:Speeders`, `tab:Quotas & monitor`.
