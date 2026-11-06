# Project setup: markets, go-live rules, payouts, bulk edits and cloning

Changes from Kunal's testing feedback (2026-11-06).

## Create project
- **Order**: Project information → **Basics** (LOI, IR, completes, client CPI, CPI currency, target group, live/test link) → **Target markets** → **Vendors** → **Gate survey questions**.
- **One CPI currency** per project, picked in Basics (`currency` on `POST /projects`); it replaces per-market currencies.
- **Country picker**: every ISO 3166 country and territory (`apps/web/lib/countries.ts`), type to search (aliases such as UK, USA, UAE, Korea), best match first, with flags. Windows has no flag emoji, so `public/fonts/TwemojiCountryFlags.woff2` (Twemoji, CC BY 4.0) is loaded for regional-indicator characters only.
- **Same country more than once**: a market is country + language + target group. Two markets with all three equal are refused (`… is listed twice. Give it a different target group`). The unique index on `(projectId, countryCode, language)` was dropped (migration `20261108090000_markets_and_custom_options`).
- **Apply to all**: the markets table has a fill bar; values typed there go into the ticked rows, or every row shown when none are ticked. Rows can be filtered and removed in bulk. Paste from Excel accepts country names and a 7th column, target group.
- **Vendors on create**: `vendors: [{ vendorId, cpi, uidParam = "vid", allowAboveCpi }]` are added to every market. "Preselect these vendors on every new project" stores them as `defaultVendor` custom options.
- **Gate questions on create**: `gateQuestions` (same model as the Gate & security tab), when the gate survey is on.
- **Add +**: category and target group dropdowns accept new values, saved per organisation in `CustomOption` (`GET/POST /custom-options`, `POST /custom-options/replace`, `DELETE /custom-options/:id`; fields `category`, `targetGroup`, `language`, `uidParam`, `defaultVendor`).

## Manage project
- Header shows LOI and IR, **Clone project** (`POST /projects/:id/clone` with `name`, `includeVendors`, `includeQuotas`, `includeSurveyLinks`; new draft, new project code, new entry links; respondents and money are not copied) and money tiles: client CPI range, expected revenue (CPI × target), revenue, vendor cost and margin so far (`finance` on `GET /projects/:id`, per currency).
- **Add market** after creation (`POST /projects/:id/countries`): missing settings come from `copyFromCountryId` (or the first market); `copyVendors` adds that market's vendors with new links. The project's currency is kept. "Copy" on a row still clones a market with vendors and quotas.
- **Bulk edit markets**: `PATCH /projects/:id/countries/bulk { countryIds, set }` sets LOI, IR, CPI, completes, links or status on many markets; markets that cannot take the change are listed in `failed`.

## Go-live rules
- A **market** can be set live only with a live survey link and at least one vendor (`NOT_READY`).
- A **project** goes live when at least one market is ready. Ready markets in draft/test go live with it; markets on hold stay on hold; markets without a link or vendor stay in draft and are returned in `launch.notReady`, shown as an alert. If no market is ready, the request is refused with the list.
- **Projects list**: tick Live projects to put them on hold, or Hold projects to set them live (`POST /projects/bulk-status { ids, status: LIVE|HOLD }`; each project checked on its own; Draft, Test, Closed and Invoiced are never moved in bulk). See docs/PROJECT_STATUS_AND_REDIRECTS.md.

## Vendor payouts
- A payout above the market's client CPI is refused with `PAYOUT_ABOVE_CPI` unless `allowAboveCpi: true`; the web app asks for confirmation and retries. Applies to adding and editing allocations and to vendors on create. Accepting a vendor quote counts as confirmed.
- Payout, target completes and link variable are editable on the Vendors & links tab; "By vendor" view sets one payout across all markets.
- The web app uses `vid` as the default link variable. The API default stays `uid` for existing API callers.
- Vendors & links shows a vendors-per-market summary and can be grouped by market or by vendor.
