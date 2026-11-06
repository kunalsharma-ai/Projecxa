# Help icons ("i")

Every page, project tab, important section and key field has a small **i** icon. Clicking it (or
Enter/Space on the keyboard) opens a short card with three parts:

- **What it is for**
- **How to use it**
- **Where it applies**

The card closes with Escape, the close button or a click anywhere else. It opens on click rather than
hover so it works the same on phones.

## Where the words live

All the text is in one file: [`apps/web/lib/help.ts`](../apps/web/lib/help.ts). Edit the text there
and every icon changes. No other file holds help text.

| Key | Where the icon shows | Example |
| --- | --- | --- |
| `page:<route>` | Next to the page title (found from the URL; ids written as `[id]`) | `page:/projects/[id]` |
| `tab:<name>` | Next to the active project tab | `tab:Quotas` |
| `section:<title>` | Next to a card title that is plain text, on any page | `section:Field dates` |
| `section:<route>::<title>` | Same title, only on that page (wins over the general one) | `section:/projects/new::Gate survey questions` |
| `field:<label>` | Next to a field label. A trailing `*` and a final `(…)` are ignored, so `Client CPI (USD) *` uses `field:Client CPI` | `field:Payout CPI` |
| `check:<key>` | Security checks on Create project | `check:geolocation` |
| any other id | Passed as `help="…"` where the title is not plain text (it has an icon or a count) | `project.autopilot` |

A label or title with no entry simply shows no icon, so generic labels such as "Name" or "Status"
stay clean.

## Adding an icon

- **A new page:** add `page:/your/route`. `PageHeader` picks it up.
- **A new section with a plain-text title:** add `section:Your title`. `Section` picks it up.
- **A section whose title has an icon or a number:** add an id such as `area.thing`, and pass
  `help="area.thing"` to `<Section>`.
- **A field:** add `field:Your label`. `<Field>`, `<Label>` (from `components/help.tsx`, the
  replacement for `<span className="label">`) and the smart form `FormField` pick it up. Smart form
  fields that already pass their own `help` keep it.
- **Anything else:** `<InfoTip id="your.id" />` from `components/help.tsx`.

## Checks

`pnpm --filter @projexa/web test` runs `scripts/check-help.ts`, which fails when:

- a staff or portal page has no `page:` entry,
- a project tab has no `tab:` entry,
- a security check has no `check:` entry,
- a `help="…"` id in the code has no entry,
- an entry is missing what/how/where, or a line is longer than 260 characters.

## Apply to all, copy and phone systems

The Apply to all boxes (`bulk.*`, set with `help=` on `BulkFill`), Copy all links (`vendors.copyAll`), redirect override pickers (`redirect.override.*`), Android/iOS device choices (`device.*`) and device quota conditions (`quota.device`) have their own entries.

## Not covered yet

- The Android/iOS app has no help icons.
- Sign-in, registration and respondent-facing pages have no icons on purpose.
