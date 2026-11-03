# Converted totals in reports (Milestone 28)

Reports now show money in two ways:

- **In the reporting currency** (the default). Every row and total is converted with the manual exchange rates in **Settings → Finance** (`/settings#finance`). Margins work across currencies in this mode.
- **Market currencies**. Each currency is shown on its own line and never added to another, as before.

The switch sits above the Overall, Clients and Vendors reports. Each person's choice is remembered in their browser.

## How conversion works

- Rates are entered by hand (no paid FX feed): 1 unit of a currency = `rate` units of the reporting currency.
- Conversion uses **today's** rates for every period, not the rate on the day of each complete. The screen and the PDF show the rates and when they last changed.
- A currency with money but no rate is left out of the converted figures. The row is marked with `*` and a warning names the currency, with a link to add the rate.
- Rejected completes stay out of revenue and payout, as in market mode.

## Where it appears

| Place | What changed |
| --- | --- |
| API `GET /reports/overall`, `/reports/summary` | Every row has `reporting: { currency, revenue, payout, profit, margin, missing[] }`; responses include `fx: { currency, rates[], updatedAt }` |
| Reports screen | Switch between converted and market currencies for tiles, tables and margin |
| CSV from the screen | Market-currency columns plus `Revenue (USD)`, `Payout (USD)`, `Profit (USD)`, `Margin % (USD)` and `Not converted (no rate)` |
| PDF `GET /reports/pdf?money=reporting` | Converted tiles (with margin) and columns, plus a note listing the rates; the Download PDF button follows the switch |
| Scheduled report emails | A "Profit converted" tile and line; the attached CSV stays one line per currency |

Tests: `apps/api/test/e2e/reports.e2e.spec.ts` ("money is also converted into the reporting currency").
