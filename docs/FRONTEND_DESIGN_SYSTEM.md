# PROJEXA frontend design system

This document answers the design deliverables in Kunal's "PROJEXA frontend design prompt" (November 2026). It covers what milestone 4 builds and how the rest is phased. Scope is the signed-in application only: the staff workspace and the client and vendor portals. There are no marketing pages.

The order of priority is the one the prompt sets: **usability, then speed, then clarity, then accessibility, then visual sophistication.**

## 1. Audit of the existing frontend (before milestone 4)

| Area | What existed | Gaps against the prompt |
|---|---|---|
| Shell | Fixed 240px sidebar, a top bar with the organization name and sign out | No collapse, favorites, recents, search, quick create, notifications, theme switch or insights |
| Tokens | Eleven colour variables, light and dark from the OS only | No themes, user preferences, density, radius, font size or motion |
| Components | `card`, `btn`, `input`, `th`/`td`, `chip` classes and a few React helpers (`Section`, `Progress`, `Toggle`) | Spinners instead of skeletons, no motion system |
| Dashboard | Six tiles, live projects, fieldwork health | No trend, no alert list |
| Reports | Five reports, filters and CSV (milestone 3) | Chart colours fixed |
| Projects | List, multi-country wizard, project workspace with countries, vendors, redirects, QA studio, respondents | Only one (table) view |
| Portals | Client and vendor portals (milestone 2) | Same visual system; no theme choice |

**Nothing was duplicated.** Milestone 4 restyles and extends the screens above. Bids and RFQs stay in Bidzo (see section 8).

## 2. Navigation

- **Sidebar** (`components/shell/sidebar.tsx`)
  - Expanded (256px) or icons-only (72px). Toggle with the button at the bottom or the `[` key.
  - The setting is saved per user.
  - **Favorites:** star any item to pin it at the top.
  - **Recent projects:** the last projects opened (up to 8 kept, 5 shown) appear in the sidebar automatically.
  - The active page is marked by an accent bar and `aria-current="page"`.
  - On phones the sidebar becomes a drawer.
- **Top command bar**
  - Global search and commands: `Ctrl/⌘ K` or `/`.
  - **Quick create:** New project. New bid opens Bidzo when `NEXT_PUBLIC_BIDZO_URL` is set.
  - **Notifications:** a count of alerts, with the alerts in a dropdown.
  - **Theme switcher:** mode and the 8 themes.
  - **Insights panel toggle:** the `]` key.
  - **Account menu:** Theme Studio, organization settings, sign out.
- **Command palette** (`components/shell/command-palette.tsx`)
  - Jumps to pages, projects (searched on the server), clients and vendors (which open their reports).
  - Runs actions: dark/light, sidebar, insights, any theme.
  - Fully keyboard-driven, with combobox/listbox ARIA roles.
- **Insights panel** (`components/shell/insights-panel.tsx`)
  - Hidden by default.
  - Overlays the page below 1536px and docks beside it above that, so it never narrows tables permanently.
  - Shows a rules-based attention list from `GET /api/v1/insights`: failed callbacks, redirect fallbacks, markets near target, live markets with no traffic for 24h, and completes waiting for review. It also shows recent audit activity.
  - It is labelled as rules-based. The AI copilot comes later (section 13).

## 3. Theme system

- **Eight themes**, each with a light and a dark palette (`lib/theme.ts`):
  - Midnight Intelligence
  - Arctic Executive (default)
  - Emerald Matrix
  - Obsidian Gold
  - Royal Sapphire
  - Aurora Rose
  - Graphite Minimal
  - Solar Executive
- **Personal controls** in the **Theme Studio** (`/settings/appearance`):
  - Colours: primary and secondary accent, application background, card background, sidebar style (theme, light card, high contrast).
  - Effects: border intensity, gradient intensity, glass level.
  - Layout: font size (4 steps), density (compact, comfortable, spacious), corner radius (0–24px).
  - Motion level, chart palette (theme, ocean, vivid, mono), and light/dark/system mode.
- **Behaviour:**
  - Live preview.
  - One-click reset with confirmation.
  - Saved to the user profile (`User.preferences`, `PATCH /auth/me/preferences`, validated by zod), so people in the same organization each keep their own theme.
  - Portal users get the quick theme switcher.
- **Accessibility is enforced by the engine, not left to taste:**
  - Every preset palette passes WCAG AA. `pnpm --filter @projexa/web test` runs the check, and CI runs it too.
  - Body text is ≥ 7:1 on cards and secondary text ≥ 4.5:1 on cards and sunken surfaces. Accent text is ≥ 4.5:1 and status colours are ≥ 4.5:1.
  - When a user-picked colour would fail, the engine shifts the text shade until it passes and the Studio says so.
- **No flash:** a tiny inline boot script paints the cached theme before React loads.

## 4. Motion system

- Three levels, set per user:
  - **Essential:** 0ms, no animation.
  - **Refined:** the default, 160/260ms.
  - **Cinematic:** 220/420ms.
- Everything runs through two CSS variables (`--dur`, `--dur-slow`) and one easing curve. Components never hard-code durations.
- What animates: page entrance, sidebar width, active indicator, popovers and the palette, button press, progress bars, chart bars, skeleton shimmer, and the staggered insight list.
- **Rules:**
  - Nothing animates continuously.
  - Saving, navigation and typing never wait for an animation.
  - The OS "reduce motion" setting overrides the user's level.
- Libraries:
  - Motion for React and GSAP are not added yet. CSS covers every current case at zero bundle cost.
  - They will be introduced only where a sequence genuinely needs them (phase 6, drag-and-drop dashboard).

## 5. Design tokens

| Token | Purpose |
|---|---|
| `--bg`, `--panel`, `--sunken`, `--line` | App background, cards, inset surfaces, borders (border strength is derived from the border-intensity setting) |
| `--ink`, `--muted` | Primary and secondary text |
| `--brand`, `--brand-ink`, `--accent2` | Primary accent, text on it, secondary accent |
| `--ok`, `--warn`, `--bad`, `--info` | Reserved status colours, the same in every theme, always paired with an icon or label |
| `--sidebar`, `--sidebar-ink`, `--sidebar-muted`, `--sidebar-active` | Sidebar surface and text |
| `--chart-1…4` | Chart series colours |
| `--radius`, `--font-scale` | Shape and type size |
| `--row-y`, `--cell-x`, `--field-y` | Density |
| `--dur`, `--dur-slow`, `--ease` | Motion |
| `--grad`, `--glass` | Gradient and glass strength (glass only on chrome: top bar, menus, palette) |

Tailwind exposes the colour tokens as utilities (`bg-panel`, `text-muted`, `bg-chart-1` and so on), so components never use raw colours.

## 6. Component library

| Component | Status |
|---|---|
| Buttons (primary, ghost, danger; press feedback), inputs with an animated focus ring, density-aware tables, chips | Built |
| `PageHeader`, `Section`, `Progress` (animated, ARIA progressbar), skeleton `Loading`, `Empty`, `ErrorBox`, `Toggle` | Built |
| `Popover`, `CommandPalette`, `Sidebar`, `InsightsPanel`, `ThemeMenu`, segmented control, slider, colour field | Built in milestone 4 |
| `TrendChart` (hover tooltip, keyboard focus, chart palette) | Built |
| Searchable select, multi-select chips, date-range picker, radio cards, drag-and-drop upload, inline edit | Phase 5 (Smart Form system) |
| Data grid (TanStack Table): column resize, pin, reorder, multi-sort, saved views, virtualisation | Phase 5 |

## 7. Dashboard ("Command center")

Milestone 4 delivers the following:

- Renamed KPI tiles with an accent edge.
- A 14-day completes chart.
- Quota achievement per live project.
- Fieldwork health.
- Alerts in the bell and insights panel.

**Phase 6** adds:

- Drag-and-drop, resizable widgets with saved layouts.
- A geographic map of live markets.
- A revenue → cost → profit waterfall.
- A fieldwork heatmap (hour × day).
- Delayed and high-risk projects, once project timelines exist.

Numbers stay exact: charts show the same values as the reports API.

## 8. Bid Creation Studio

**Decided (Kunal, 2026-11-01): bids stay in Bidzo.** PROJEXA links to Bidzo from Quick Create and the command palette (`NEXT_PUBLIC_BIDZO_URL`). PROJEXA does not get its own bid model. If the Bid Studio below is built, it is built in Bidzo using this design system.

The design is ready either way:

- **Layout:** three panels. Left: sections, progress and validation. Centre: compact form. Right: live price, revenue, cost and margin.
- **Modes:** Quick, Guided and AI-assisted.
- **Behaviour:** autosave, templates, clone and bulk countries.

## 9. Project Creation Studio and 10. Country Selection Studio

The existing multi-country wizard and countries tab already cover the following, and they pick up the new tokens:

- Excel paste.
- Clone country.
- Per-country language, LOI, IR, CPI, currency and targets.
- Vendors, quotas and redirects per country.

**Phase 5** adds:

- A region-grouped country picker with search and saved country groups.
- A table/map view switch. The table stays the default, so routine entry never needs the map.
- A live summary panel in the wizard.

## 11. Redirect Management Studio

The milestone 1 module already provides:

- Static, dynamic and hybrid modes.
- Project, country and vendor overrides.
- The eight statuses.
- UID, vendor ID and country code mapping.
- Callbacks, versioning and rollback.
- The QA simulator.
- The effective routing matrix and the callback log.

**Phase 5** adds:

- A routing diagram view.
- A version diff ("configuration comparison").
- A visual URL builder.

Editable tables stay the primary interface.

## 12. Client and vendor portals

The portals share the same tokens and theme engine. Each user can switch theme and mode from the portal header.

**Planned with the matching backend:**

- Client portal: RFQs, documents and communication.
- Vendor portal: feasibility, quotations and invoices.

## 13. AI Copilot and voice

**Not built yet.** It needs an agreed model provider, data-access rules and audit for actions.

Until then:

- The command palette is the entry point the copilot will extend: natural-language search and "explain this quota" commands.
- The insights panel is the surface its suggestions will appear in.

**Voice** will include:

- A clear recording indicator and a transcript preview.
- Confirmation before any change.
- Permission checks.
- A text alternative.

## 14. Mobile and tablet

- **Phones and small tablets (below 1024px):** the sidebar becomes a drawer; the search button shrinks; tiles stack.
- **Wide tables:** they scroll inside their card, never the page.
- **Insights panel:** it overlays on every screen below 1536px.
- **Verified widths:** every screen is checked at 390px and 1440px, with no horizontal page scroll.

## 15. Accessibility and performance

**Accessibility (WCAG 2.2 AA target):**

- Contrast enforced by the engine and checked in CI.
- Visible focus rings everywhere.
- A skip link.
- Keyboard shortcuts that ignore typing fields.
- ARIA on dialogs, popovers, radiogroups, the palette and progress bars.
- Reduced motion respected.
- No colour-only status.

**Performance:**

- No new runtime dependencies in milestone 4.
- Theme changes are CSS-variable writes, with no re-render of the page tree.
- Insights refresh every 2 minutes.
- Project search is debounced and stale responses are dropped.

## 16. Component architecture

```
apps/web
├─ lib/theme.ts               theme engine (palettes, contrast maths, resolve → CSS vars, boot script)
├─ components/theme.tsx       ThemeProvider: state, debounced save to the profile, reset
├─ components/shell/          sidebar, command palette, popover, theme menu, insights panel, nav config
├─ components/ui.tsx          base components
├─ components/reports/        report widgets (trend chart, summary table, filter bar)
└─ app/(app)/settings/appearance  Theme Studio
```

## 17. Non-duplication

- **Bids and RFQs:** they stay in Bidzo, reached through Quick Create.
- **Sales pipeline:** it stays in DealFlow.
- **Navigation and search:** the command palette and insights reuse the existing projects, clients, vendors, reports and audit data. The one new endpoint, `GET /insights`, reads existing tables.
- **Personal preferences:** the only schema change is the `User.preferences` column for them.

## 18. Phases

| Phase | Content |
|---|---|
| **4 (this PR)** | Design system, theme engine and Studio, motion levels, new shell (sidebar, command bar, palette, insights), dashboard refresh, restyle of all screens through tokens |
| 5 | Smart Form system, data grid, country selection studio, redirect diagram and version diff |
| 6 | Dashboard widgets (drag, resize, save), map, waterfall, heatmap; Motion for React where needed |
| 7 | AI copilot and voice, once a provider and policies are agreed |
| — | Bid Studio: in Bidzo, using this design system (decided 2026-11-01) |

## 19. QA and usability testing

**Automated (every change):**

- API e2e tests for preferences (merge, per-user, validation, reset) and insights (tenant scope).
- The palette contrast check.
- Typecheck and production build in CI.

**Manual (every change):**

- A Playwright walk-through at 1440px and 390px across several themes and both modes.

**Usability testing:**

- Time common tasks with 3–5 project managers on the new shell: find a project, switch to a client's report, review completes. Compare against the old shell.
- Test the bid target (under three minutes for a repeat bid) in Bidzo once the Bid Studio is built there.
