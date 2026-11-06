# Command center widgets (Milestone 29)

> Since the dashboard overview change, these widgets live under **Detailed view → Show details** on the Dashboard. See docs/DASHBOARD_OVERVIEW_AND_MENU.md.

The command center (`/`) is now a set of widgets that each person can arrange.

## Customize

Press **Customize** to:

- **Move** a widget by dragging its handle, or with the up and down arrows (keyboard and touch friendly).
- **Resize** it: narrow (⅓), half, wide (⅔) or full width. Sizes apply on large screens; on phones widgets stack, and on laptops two narrow widgets share a row.
- **Hide** it, and bring hidden widgets back from the "Hidden" chips.

**Done** saves the layout to your account, so it follows you to other browsers. **Cancel** drops the changes. **Reset** goes back to the standard layout. Layouts are personal: changing yours never changes a colleague's. Widgets added in later versions appear at the end of a saved layout.

Each widget lays out its own content for its width (container queries), so a half-width key-numbers widget shows two or three tiles per row instead of five squeezed ones.

## Widgets

| Widget | What it shows |
| --- | --- |
| Key numbers | Revenue, cost and profit in the reporting currency (converted with the manual rates), clicks and completes, with change against the previous period |
| Revenue, payout and profit | Daily, weekly or monthly chart (bars or lines) |
| Markets map | World map shaded by completes, converted revenue or conversion, with a ranked list; hover a country for detail. Small markets (Singapore) are drawn as a dot |
| Revenue to profit | Waterfall in the reporting currency: value of all completes, minus rejected, gives revenue; minus vendor payout gives profit. Also shows the margin and how much revenue still awaits approval |
| Reconciliation and invoicing, Vendor payables | All-time finance tiles, as before |
| Top 5 vendors, projects, clients | Ranked by revenue in the period |
| Live projects | Quota achievement |
| Fieldwork health | Redirects, callbacks and outcomes |
| Traffic by hour | Heatmap of respondent entries (or completes) by weekday and hour, in the viewer's own time zone |
| Workspace | Clients, vendors and projects |

The map, heatmap and waterfall load only when they are visible.

## API

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/v1/dashboard/layout` | `{ custom, widgets: [{ id, size, hidden }], available }` |
| PUT | `/api/v1/dashboard/layout` | `{ widgets }`; each widget once, known ids and sizes, at least one visible |
| DELETE | `/api/v1/dashboard/layout` | Back to the default |
| GET | `/api/v1/dashboard/markets?from&to` | Per country: clicks, completes, conversion, converted revenue/profit/margin, currencies without a rate, live markets |
| GET | `/api/v1/dashboard/heatmap?from&to&tz` | 7×24 entries and completes (Monday first); `tz` must be a real IANA time zone |
| GET | `/api/v1/dashboard/waterfall?from&to` | Steps, pending revenue, margin, currencies without a rate |

`GET /dashboard` also returns `period.converted` (money KPIs in the reporting currency with trends).

Data: `User.dashboardLayout` (JSON). Migration `20261102160000_dashboard_layout`. The map uses the public-domain Natural Earth outlines from the `world-atlas` package, bundled with the app (no map service or API key).

Tests: `apps/api/test/e2e/dashboard-widgets.e2e.spec.ts`.
