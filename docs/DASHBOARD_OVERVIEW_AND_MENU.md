# Simple dashboard overview and menu order

Testing feedback: the command center felt too complicated, and the menu was not in the order the team works in.

## Dashboard (`/`)

The page is now called **Dashboard** and opens with a simple overview:

- **Projects**: all projects, Live, Test, On hold, Closed (drafts and invoiced shown under "All projects"). Each number opens the project list filtered to that status (`/projects?status=LIVE`).
- **Clients and vendors**: totals with how many are active; each opens its list.
- **Clicks, completes and revenue** for **Today**, **Yesterday**, **Last 7 days** and **This month**, each with the change against the window just before it (yesterday, the day before, the 7 days before, the same days last month), plus conversion, cost and profit. Each card opens Reports for those exact days (`/reports?from=…&to=…`).

Numbers come from `GET /dashboard/snapshot`. Test traffic is never counted, days are UTC (same as Reports), and money is in the reporting currency (Settings → Finance rates); a currency without a rate is left out and named on the card.

Everything that was on the command center (charts, top 5 lists, finance and payables tiles, markets map, heatmap, waterfall, project board panels, lifecycle ring and copilot box) is under **Detailed view → Show details**, with **Customize panels** as before (docs/DASHBOARD_WIDGETS.md). Whether the details are open is remembered per browser; they are folded by default and load only when opened.

## Menu

The sidebar now starts with the main pages in working order, without a heading:

**Dashboard → Clients → Vendors → Projects → Reports**

then **Projects & fieldwork** (Create project, Project board, Won bids, Fieldwork monitor, Redirect health, Data processing, Analytics), **Finance**, **Work** (Tasks, Requests, AI copilot) and **Admin** (Portal access and settings).

**Favorites** sit at the top: click the star next to any page to pin it there (on phones the stars are always visible). Favorites are saved to the person's account. Order and labels live in `apps/web/components/shell/nav.ts` (`NAV`, `NAV_GROUPS`, `NAV_GROUP_LABEL`).
