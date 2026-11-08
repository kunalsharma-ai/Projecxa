# Moving to samptrek.sampledge.com

Sampledge's own SampTrek server moves from **projexa.sampledge.com** to **samptrek.sampledge.com**
(decided 6 November 2026). The code has no host name built in: every link comes from the server
settings below, so the move is a settings, DNS and TLS change, then a rebuild and restart.

## 1. DNS and TLS

- Add `samptrek.sampledge.com` in DNS, pointing at the same server as `projexa.sampledge.com`.
- Get a TLS certificate for it (Caddy does this by itself; see INSTALL.md, Reverse proxy and TLS).
- **Keep `projexa.sampledge.com` working.** Entry links already sent to vendors, links in client
  surveys, unique links and webhook receivers still use the old host. Either serve both names from
  the same API, or permanently redirect the old name to the new one, keeping the path and query:

  ```
  projexa.sampledge.com {
    redir https://samptrek.sampledge.com{uri} permanent
  }
  ```

  Remove the old name only after every project that used the old links is closed.

## 2. Server settings

Change every setting that says `projexa.sampledge.com` to `samptrek.sampledge.com`:

| Where | Setting | What it does |
| --- | --- | --- |
| `apps/api/.env` | `PUBLIC_BASE_URL` | Vendor entry links, test links, unique links, redirect and end-page links, SSO and accounting redirect URIs |
| `apps/api/.env` | `WEB_ORIGIN` | Web app address: CORS, links in emails, where people land after signing in. Add the new address first; keep the old one after a comma during the move |
| `apps/web/.env.local` | `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_WEB_ORIGIN` | Read at **build time**: rebuild the web app after changing them |
| `apps/mobile/eas.json` | `EXPO_PUBLIC_API_URL` | Default server for new mobile builds; people on older builds can type the new address on the sign-in screen |

If the web app and API have their own names (for example `app.` and `api.`), use the matching
`samptrek` names, such as `api.samptrek.sampledge.com`. Then rebuild and restart (INSTALL.md steps 5 and 6).

## 3. Outside services that hold the old address

Redirect URIs are built from `PUBLIC_BASE_URL`, so after the change add the new ones (shown with copy
buttons in the app) at each provider you use, and keep the old ones until the move is done:

- **Sign-in with Google, Microsoft, Zoho** (Settings → Single sign-on): `…/api/v1/auth/sso/<provider>/callback`
- **Xero and QuickBooks** (Accounting page): `…/api/v1/accounting/ledgers/<xero|quickbooks>/callback`
- **Client survey platforms**: return links in Decipher/Forsta, Qualtrics, Alchemer and others
  (Redirects popup on each project). Live surveys keep working through the old host (step 1);
  use the new links for new projects.
- **SampBidx and SAMPLEON** if they call SampTrek's webhooks or API at the old host.
- **Custom domains** (Settings → Branding) point their CNAME at the web app's host name; update the
  target if it was `projexa.sampledge.com`.

## 4. Check

- Open a project → Vendors & links and copy a test link: it starts with `https://samptrek.sampledge.com`.
- Open an old `https://projexa.sampledge.com/...` test link: it still reaches the survey (or redirects).
- Sign in with each SSO provider you use.
