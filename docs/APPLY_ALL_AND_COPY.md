# Apply to all for links, and copy icons

## Apply to all
Type a value once and put it on many rows. Only filled-in fields change.

| Where | What it fills |
| --- | --- |
| Create project → Markets | LOI, IR, CPI, completes, target group, **live link, test link** (ticked rows, or all) |
| Create project → Vendors | payout and link variable for every vendor |
| Project → Overview → Markets | LOI, IR, CPI, completes, **live link, test link**; Set live / Hold |
| Project → Vendors & links | payout, target completes and **link variable** for every vendor link, or one vendor / one market; Pause / Resume; **Copy all links** (market, vendor, live, test as rows for Excel) |
| Project → Redirects → Status matrix | one **custom URL for every status** (`{status}` in a dynamic URL becomes complete, terminate, …); "Reset to prebuilt" puts all back on the vendor's saved redirect |
| Project → Redirects → Overrides | Country **Every market**, Vendor **Every vendor**, Status **Every status**: adds one rule per combination and replaces existing rules with the same scope |

Vendor payouts above the client CPI still ask once for the whole batch.

## Copy icons
`components/copy.tsx` has `copyText` (Clipboard API with a fallback for plain http), `CopyIcon` (icon button, tick when copied) and `Copyable` (value + icon). They are on: project ID and work order (project header, projects list), bid reference, survey live/test links, end-of-survey and server-to-server URLs, vendor IDs, vendor redirect and callback URLs (vendor page, Redirects tab), override and effective destination URLs, client IDs, invoice numbers and payment references, respondent IDs (Sessions, vendor portal), unique link keys, won bid numbers.

Use `Copyable` / `CopyIcon` for any new ID or link shown in the UI.
