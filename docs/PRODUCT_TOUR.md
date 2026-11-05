# Product tour

A guided tour that opens after sign-in and walks staff through the main features of the app.

## What people see

1. **Welcome card** with three choices:
   - **Start tour**: step through the features.
   - **Remind me later**: closes the tour for this sign-in only. It opens again next time they sign in (stored in the browser tab's session storage).
   - **Skip tour**: closes it for good. This is saved on the server.
2. **One step per feature.** The rest of the screen is dimmed and the feature is outlined, with a card beside it: what it is and what lives there. Steps: command center, search (Ctrl K), projects, create project, won bids, fieldwork monitor, redirect health, reports, invoices and payables, clients and vendors, client and vendor portals, tasks, AI copilot, alerts and insights, settings and integrations, Theme Studio, and the account menu.
3. **Finish** on the last step saves the tour as completed.

Every step has **Skip tour** and an × button. Keyboard: → next, ← back, Esc skip; focus stays inside the card.

Steps follow the person's role, like the sidebar: *Create a project* is shown to admins and project managers, *Settings and integrations* to admins only. If a step's feature is not on screen (for example the copilot button on the copilot page), the card shows in the middle. On phones the sidebar drawer opens for sidebar steps and closes again afterwards.

The tour does not show while someone has to set up two-step sign-in first. Client and vendor portal users do not get this tour.

## Replay

- Account menu (person icon, top right) → **Take the product tour**.
- Ctrl K → type "tour" → **Take the product tour**.

## How it is stored

`User.tourVersion`, `User.tourOutcome` (`completed` or `skipped`) and `User.tourAt`. These are kept apart from interface preferences, so *Reset* in Theme Studio does not replay the tour.

- `GET /api/v1/auth/me` returns `tour: { version, show, outcome, at }`. `show` is true until the person finished or skipped the current version.
- `POST /api/v1/auth/me/tour` with `{ "outcome": "completed" | "skipped" | "reset" }` saves it; `reset` shows the tour again at the next sign-in.

## Changing the tour

- Steps live in `apps/web/lib/tour.ts`. A step points at an element with a `data-tour` attribute: `nav:<href>` for a sidebar link (added automatically), or `search`, `copilot`, `notifications`, `account` in the header. `{app}` in a title or body becomes the organisation's app name (white-label).
- After a large release, raise `TOUR_VERSION` in `apps/api/src/auth/tour.ts`. Everyone sees the tour again once, even if they skipped the old one.
- `pnpm --filter @projexa/web test` runs `scripts/check-tour.ts` (every sidebar step points at a real page, role filtering, card placement).
