# Neon Command design (2026-11)

The whole web CRM now uses the **Neon Command** look from Kunal's two mockups
(*PROJEXA Research Command Centre* and *PROJEXA Neon Project Management Suite*):
violet and electric-blue gradients, frosted glass cards and a deep indigo navigation rail.
The mockups were used as visual direction only; every number on screen is real data.

## What changed

| Area | Change |
| --- | --- |
| Theme engine (`apps/web/lib/theme.ts`) | New theme `neon` ("Neon Command"), first in the list and the **default**. Default corner radius is 16px. The API accepts `neon` for personal preferences and for the organisation's default theme (white-label). |
| Global styles (`apps/web/app/globals.css`) | Neon-only rules (scoped to `[data-theme='neon']`): glowing page background, glass cards, gradient pill buttons, frosted inputs with focus glow, tinted table headings, pill tab bars with a gradient active tab, glowing brand icon. Shared helpers for all themes: `.icon-tile` + `.tone-*` gradient icon squares, `.bg-neon`, `.text-gradient`. |
| Sidebar | Indigo rail with violet and blue glows; current page is a glowing gradient pill; items grouped into Workspace, Fieldwork, Finance, Network and Admin; product name with "Research PM suite" tagline (a white-labelled organisation shows its own name and tagline). |
| Header | Taller, rounded search, a **New project** gradient button for editors, and a profile chip with initials, name and role. |
| Command center | New opening panel: the research lifecycle as a ring of linked stages (Won bids → Project setup → Gate & survey → QA testing → Fieldwork → Reporting → Invoice → Closure) with live project counts, and an AI copilot question box (opens the copilot with the question filled in; nothing is sent until you press Send). It can be folded away (remembered per browser). KPI cards have gradient icon tiles. |
| Project page | Stat cards with gradient icon tiles; two columns on phones. |
| Sign-in, forgot password, set password | Split layout: neon panel with the lifecycle on wide screens, form on the right. |

## Keeping other looks working

* Every neon effect is built from the theme tokens (`--brand`, `--accent2`, `--panel` …), so
  Theme Studio accent colours and a white-label brand colour recolour the neon look too.
* White text on gradients uses `--neon-a` / `--neon-b`, which deepen the accents
  (light ×0.94/×0.80, dark ×0.72) so it stays at or above WCAG AA 4.5:1 even for light accents.
* People who picked another theme keep it. Only people who never chose a theme (and new users)
  get Neon Command; anyone can switch back in Theme Studio. An organisation can still set its
  default theme in Settings → Branding.
* The other eight themes keep their flatter look; they gain only the grouped sidebar, header,
  hero and icon tiles.
* Respondent-facing pages (gate, end pages) are designed per project and are not affected.
