# Data grid and redirect diagram (Milestone 30)

## Data grid

`apps/web/components/data-grid.tsx` is a reusable table for long lists. The Projects list uses it first.

- **Sort**: click a header to sort ascending, again for descending, a third time for the default order. A grid sorts either on the server (`sort` + `onSort`, for paged lists) or in the browser (`sortValue` on each column).
- **Resize**: drag the right edge of a header.
- **Show or hide columns** from the Columns menu. Some columns start hidden (on Projects: project ID, in survey, quality fails, sales person, field end date). "Reset columns and widths" restores the defaults.
- **Pinned first column**: the project name stays visible while you scroll sideways, which helps most on phones.
- **Sticky header** inside the scroll area, and **Comfortable / Compact** rows.
- Column choices, widths and density are remembered per grid in the browser.

The Projects API takes `sort` (`created`, `name`, `code`, `status`, `client`, `manager`, `fieldEnd`) and `dir` (`asc`, `desc`). Text columns sort as people read them: case-insensitive, with numbers in order. Ties fall back to newest first, so paging stays stable. The list now also returns `fieldStartAt` and `fieldEndAt`. CSV export follows the chosen sort.

## Redirect diagram

The **Effective routing** section of a project's Redirects tab now opens as a diagram, with the table one click away. Pick a market and a vendor to see the respondent journey:

1. **Vendor entry**: the vendor's entry link.
2. **SampTrek checks**: the security checks that are on, and the gate survey if there is one. Duplicates and security rejects are decided here, before the survey, so they are drawn as dashed lines from this step.
3. **Client survey** for that market.
4. **Each outcome** (complete, terminate, quota full, quality fail, duplicate, security reject, partial, technical error).
5. **Where it sends the respondent**, with the rule that decided it (project, market or vendor override, client template, organization default), the rule type, and whether a callback is required. API rules show the endpoint they ask (dashed); outcomes with no usable rule show the default page in amber with the reason.

Hover a box for the full address. Macros are filled with sample values. The diagram uses the same effective-routing data as the table, so it matches what respondents get from the active version.
