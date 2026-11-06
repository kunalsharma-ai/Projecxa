# SampTrek brand

SampTrek ("Projects on track. by Sampledge") is the product's name. It was called PROJEXA until
November 2026. Everything a person sees says SampTrek: the web app, sign-in pages, emails, PDFs,
the Android and iOS app, and these docs.

## Logo files

| File | Use |
| --- | --- |
| `apps/web/public/brand/samptrek-logo-dark.svg` | Full logo for **dark** backgrounds (animated SVG) |
| `apps/web/public/brand/samptrek-logo-light.svg` | Full logo for **light** backgrounds (animated SVG) |
| `apps/web/public/brand/samptrek-icon.svg` | Square icon (animated SVG) |
| `apps/web/public/brand/samptrek-logo-{dark,light}.png` | 717×192 PNGs, for emails (mail apps do not show SVG) |
| `apps/web/public/brand/samptrek-icon-512.png` | 512×512 icon |
| `apps/web/app/icon.png`, `apple-icon.png`, `favicon.ico` | Browser tab and home-screen icons (Next.js picks them up) |
| `apps/api/assets/brand/samptrek-logo-light.png` | Logo at the top right of report PDFs |
| `apps/mobile/assets/*.png`, `apps/mobile/assets/brand/*` | App icon, Android adaptive icon, splash and in-app logo |

The SVGs animate and stop animating when the device asks for reduced motion.

Where the logo shows:

- **Sidebar**: the full logo, or the icon alone when the sidebar is collapsed. The sidebar can be
  dark even in light mode, so the theme engine sets `data-sidebar-tone` on `<html>` and the
  `.sb-dark-logo` / `.sb-light-logo` classes pick the right file.
- **Sign-in, forgot and set password, vendor sign-up**: the large logo on the left panel, and the
  logo on the card (light or dark file by light or dark mode).
- **Portals**: the icon next to the product name.
- **Emails**: the PNG logo, loaded from the web app's address (`/brand/samptrek-logo-light.png`),
  so it shows once the web app is on a public address.
- **Report PDFs**: the logo at the top right.

Components: `ProductLogo` and `BrandIcon` in `apps/web/components/brand-mark.tsx`; `ProductLogo`,
`BrandMark` and `Wordmark` in `apps/mobile/src/components/gate.tsx`.

## White-label still wins

An organisation that sets its own product name in Settings → Branding (docs/WHITE_LABEL.md) never
sees the SampTrek logo or name: its own name, logo and icon replace them in the app, sign-in pages,
emails and report PDFs, exactly as before. An organisation that only uploads a logo keeps the
SampTrek name, with its own logo in emails and on sign-in pages.

## Names kept on purpose

These still say `projexa` because changing them would break running servers, saved data or other
systems. They are not shown to users.

| Kept | Why |
| --- | --- |
| Package names `@projexa/api`, `@projexa/web`, `@projexa/mobile`, the database name/user in docker-compose and CI | Internal; renaming breaks scripts and existing databases |
| Cookies `projexa_token`, `projexa_mfa`, `projexa_sso`, `projexa_ledger`; browser storage keys `projexa.*` | Renaming would sign everyone out and reset saved layouts and themes |
| Webhook and redirect headers `X-Projexa-Signature`, `X-Projexa-Timestamp`, `X-Projexa-Event`, `X-Projexa-Delivery`; user agents `PROJEXA-Webhooks`, `PROJEXA-Callbacks`, `PROJEXA-LinkCheck`; link-check token `projexa-link-check` | Receivers already check these |
| Custom-domain DNS record `_projexa.<domain>` with `projexa-verify=…` | Domains already verified with it |
| `source.platform: "PROJEXA"` and client id `projexa` sent to SAMPLEON, Tally collection `ProjexaCompanies`, Xero idempotency keys `projexa-…` | Contracts with other systems |
| Mobile bundle id `com.sampledge.projexa`, app slug and link scheme `projexa://` | Changing them makes a new store listing and breaks sign-in links in installed builds |
| Hash salts in `auth/totp.ts` | Existing two-step secrets and recovery codes depend on them |
| Demo logins `*@projexa.local` (seed only) | Documented test accounts |

Authenticator apps keep the label they had when someone set up two-step sign-in; new set-ups show
SampTrek.
