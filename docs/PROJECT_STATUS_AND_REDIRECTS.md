# Project status colours, bulk Live/Hold and the Redirects popup

## Status colours

One colour per project status, the same in every theme (`apps/web/lib/project-status.ts`, CSS variables `--st-*` in `app/globals.css`, Tailwind colours `st-live` etc.):

| Status | Colour |
| --- | --- |
| Live | green |
| Hold | orange |
| Closed | red |
| Test | blue |
| Draft | grey |
| Invoiced | purple |

Used by the status chip everywhere, the status tabs and row stripe on the projects list, and the status menu in the project header.

## Projects list

- Coloured status tabs (All, Live, Hold, Test, Draft, Closed, Invoiced) with counts. `GET /projects` now returns `counts` per status (other filters applied, status filter ignored).
- Only Live and Hold projects can be ticked. With projects ticked, **Put N live on hold** and **Set N on hold live** appear.
- `POST /projects/bulk-status` accepts only `LIVE` (moves Hold projects) or `HOLD` (moves Live projects). Any other current status is reported back as not changed. Going live still checks each project (no live link = stays on hold).

## Project header

- **Status menu**: one coloured button showing the current status; it opens every status with a one-line hint. Closed, Draft and Invoiced need a second click. Replaces the Set hold / Set closed / Go live buttons.
- **Redirects** button opens a popup:
  - all 8 prebuilt client return links with a copy icon each and **Copy all**;
  - **See it work**: pick a status and follow one respondent through four steps built from this project's own links (vendor entry link → client survey with the token → return link for that status → vendor's own page), with the example token and respondent ID highlighted;
  - snippets for Decipher/Forsta, Qualtrics, Alchemer and own code for the selected status;
  - the server-to-server confirmation endpoint with an example body.
- The **Client survey integration** card on the Overview tab is gone; its content lives in the popup.

## Branding of the return links

The links are built from `PUBLIC_BASE_URL` on the API. If they show `projexa.sampledge.com`, set `PUBLIC_BASE_URL` to the SampTrek address (and point DNS/TLS at the API). No code change is needed.
