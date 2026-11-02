# White-labelling (Milestone 33)

Each organisation can show its own name, logo and colours to its team, clients and vendors, and use its own web address. Respondent pages (entry, gate and end pages) are not changed: they already have per-project designs (Milestone 7) and stay neutral for panel members.

There are no paid plans or billing. White-labelling is available to every organisation and is managed by its admins.

## Settings → Branding (`/settings/branding`, admins)

| Setting | Where it shows |
| --- | --- |
| Product name | Sidebar, browser tab, sign-in, password and sign-up pages, portals, emails, authenticator app entries (MFA issuer) |
| Tagline | Under the name in emails |
| Sign-in message | Under "Sign in" on the custom domain |
| Support email | Portal footers, end of invitation emails, reply-to if none is set |
| Hide "Powered by Sampledge PROJEXA" | Client and vendor portals |
| Default theme and brand colour | The starting look for everyone in the organisation. A person's own Theme Studio choices still win. The colour engine keeps text readable. |
| Sender name and reply-to | All emails: invitations, password resets, scheduled reports, portal request and quote emails. The address stays the server's own `SMTP_FROM`, so SPF/DKIM keep passing. |
| Logo, dark-mode logo, icon | PNG, JPEG or WebP, up to 512 KB. The icon must be square. SVG is refused because the images are served on public pages and in emails. |

A live preview shows the sidebar, the sign-in card and an invitation email.

Images are stored in the database (`BrandAsset`). They are served from `GET /api/v1/public/branding/:slug/:kind` with `Content-Security-Policy: default-src 'none'; sandbox`, `nosniff`, and a cache-busting `?v=` hash.

## Custom domain

1. An admin enters a domain such as `research.acme.com`. The app's own host is refused, and a domain already claimed by another organisation gives 409.
2. The page shows two DNS records:
   - a `CNAME` from the domain to the main app host;
   - a `TXT` record `_projexa.<domain>` = `projexa-verify=<token>`.
3. **Check DNS** looks up the TXT record. The domain is used only after it is verified. Changing the domain issues a new token and needs a new check.
4. Once verified:
   - Invitation, password, report and portal emails link to `https://<domain>`.
   - Signed-out pages on that host (sign in, forgot password, set password, vendor sign-up) show the brand. `GET /api/v1/public/branding?host=` returns the public part only: name, logos, colours and sign-in message. It never returns reply-to or sender settings.

### What operations must do

- **TLS:** add the domain to the HTTPS certificate of the web front end (for example Caddy on-demand TLS, or an extra name on the load balancer). PROJEXA does not issue certificates.
- **Same-origin API:** build the web app with `NEXT_PUBLIC_CUSTOM_DOMAINS=true` and set `NEXT_PUBLIC_WEB_ORIGIN` to the main web origin. On any other host the browser calls `/api/v1/*` on the same host, and Next.js rewrites it to `API_INTERNAL_URL` (or `NEXT_PUBLIC_API_URL`). This keeps sign-in cookies first-party on the custom domain.
- **SSO** (Google/Microsoft/Zoho) callbacks stay registered on the main domain. People who use SSO finish signing in there.

## API

| Method | Path | Who |
| --- | --- | --- |
| GET | `/api/v1/branding` | any staff user |
| PUT | `/api/v1/branding` | admin |
| POST / DELETE | `/api/v1/branding/assets/:kind` (`logo`, `logoDark`, `icon`; multipart `file`) | admin |
| PUT / DELETE | `/api/v1/branding/domain` | admin |
| POST | `/api/v1/branding/domain/verify` | admin |
| GET | `/api/v1/public/branding?host=` and `/api/v1/public/branding/:slug/:kind` | public |

`/auth/me` also returns `branding`. Every change is written to the audit log (`branding.*`).

## Tests

`apps/api/test/e2e/branding.e2e.spec.ts` covers:
- roles and validation;
- image type, size and squareness checks, and the locked-down asset headers;
- DNS verification, including a TXT value split into several strings, and re-verification after a change;
- branded emails: sender name, reply-to, product name, logo, colour and custom-domain links.
