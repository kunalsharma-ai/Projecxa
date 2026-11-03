# Respondent pages

Every page a respondent sees for a project (the gate page and the end pages) follows the project's **page design**. Executives edit it in **Project → Respondent pages**.

## What can be changed

| Setting | Options |
| --- | --- |
| Template | `aurora`, `minimal`, `split`, `spotlight`, `bold`, `playful` |
| Colours | primary, accent, background, card, text (`#rrggbb`); eight ready-made palettes |
| Font | system, humanist, geometric, rounded, serif, mono (system font stacks only, nothing is downloaded) |
| Corners | sharp, soft, round |
| Brand | brand name, logo, hero picture (Split and Spotlight), footer text |
| Words | heading, message, button label and https link, per end status; blank uses the default |
| Extras | confetti on complete; countdown page before the vendor redirect (0 to 15 seconds) |

Projects without a saved design use the default (Aurora, Ocean palette).

## API

| Method | Path | Who | Notes |
| --- | --- | --- | --- |
| GET | `/api/v1/projects/:id/page-design` | any member | design, `custom` flag, templates, fonts, palettes, statuses, default words, `assetBase` |
| PUT | `/api/v1/projects/:id/page-design` | admin, PM | strict zod schema; logo and hero must be images of the same organisation; audited as `project.page-design` |
| POST | `/api/v1/projects/:id/page-design/preview` | any member | `{ design, page: <status>\|'gate', interstitial? }` → `{ html }`; nothing is saved |
| POST | `/api/v1/projects/:id/page-assets` | admin, PM | multipart `file`; PNG, JPEG, WebP or GIF, checked by magic bytes; 1.5 MB max |
| GET | `/pa/:id` | public | image bytes with `nosniff`, `default-src 'none'` CSP and a one-year immutable cache |
| GET | `/end/:status?t=<token>` | public | the designed end page |

## How end pages are reached

- When the redirect engine sends a respondent to our own end page, the link carries `?t=<session token>` so the page can load the project's design. Without a token (or with an unknown one) the default design is used.
- With a token, the page shows the **recorded outcome** of the session, not the status in the URL, so a respondent cannot turn a terminate page into a complete page by editing the link.
- **Countdown page** (`interstitial.enabled`): if the destination is a vendor's or client's own link, the respondent is sent to `/end/<status>?t=<token>` first. That page reads the destination from the session's latest `RedirectExecution` (already checked against the organisation's allowed domains), counts down and continues. The outcome and vendor callback are recorded once, exactly as before.

## Security

- Pages are rendered on the server with a per-request nonce: `default-src 'none'; script-src 'nonce-…'; style-src 'nonce-…'; img-src 'self' data:; form-action 'none'; frame-ancestors 'none'`. No inline `style` attributes are emitted.
- All text is HTML-escaped; colours are validated as hex; button links must be https.
- The editor's preview runs in a sandboxed iframe (`allow-scripts` only, no same-origin).
