# Single sign-on (Google, Microsoft, Zoho)

> **Now set up in the app.** Admins of the organisation that runs the server enter the client IDs and secrets in **Settings → Integrations** (see `docs/INTEGRATIONS.md`). The provider steps below still apply; the environment variables are an optional fallback.

Staff can sign in with their company Google, Microsoft or Zoho account instead of a PROJEXA password. All three use OpenID Connect (authorization code flow with PKCE). Setting it up has two parts: register PROJEXA once with each provider (server environment), then each organization turns on the providers it wants (Settings → Single sign-on).

## How sign-in works

1. The person clicks **Continue with Google / Microsoft / Zoho** on the sign-in page. If their email is in several PROJEXA organizations, they first enter the organization under "Organization".
2. PROJEXA sends them to the provider with a random `state`, `nonce` and PKCE challenge, kept in a signed cookie for 10 minutes.
3. Back at `/api/v1/auth/sso/<provider>/callback`, PROJEXA exchanges the code, then checks the ID token: RS256 signature against the provider's published keys, issuer, audience (our client ID), expiry and nonce.
4. It finds the PROJEXA user:
   - an account linked before, by the provider's account ID (`sub`; for Microsoft the tenant and object ID); or
   - the first time, an **active PROJEXA user with the same verified email**, whose organization has that provider on and lists the email's domain. The account is then linked (audit log: `sso.link`).
5. If the person uses two-step sign-in, they still enter their authenticator code. Otherwise they land on their home page.

What it never does:

- **No automatic sign-up.** People must already exist as PROJEXA users (created by an admin through `POST /api/v1/users`, or the seed). Single sign-on only replaces the password.
- **No unverified emails.** Google must say the email is verified. Microsoft must come from your own tenant (the tenant ID you enter), so accounts from other tenants with a look-alike email are refused. Zoho emails are accepted unless Zoho marks them unverified.
- **No other domains.** The email domain must be on the organization's list, both on first sign-in and every sign-in after.

## Organization settings (admins)

Settings → **Single sign-on**:

| Setting | What it does |
| --- | --- |
| Google / Microsoft / Zoho | Turn each provider on. A provider not set up on the server (below) cannot be turned on. |
| Email domains allowed | e.g. `yourcompany.com`. Required once any provider is on. |
| Microsoft tenant ID | The Directory (tenant) ID from the Microsoft Entra admin centre (Overview page). Required for Microsoft. |
| Single sign-on only | Project managers, sales and viewers can no longer sign in with a password. Admins and client or vendor portal users keep their password, so an admin can always get back in if a provider is down. |
| Linked accounts | Who has linked which provider account, and when it was last used. **Unlink** one if, for example, a mailbox was reassigned to someone else; the next sign-in links again by email. |

Turning a provider off also stops accounts already linked to it. Deactivating a user stops their single sign-on straight away.

## Server setup

Each provider needs a client ID and secret in the API environment (`apps/api/.env`, never in the database):

```
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
MICROSOFT_CLIENT_ID=...
MICROSOFT_CLIENT_SECRET=...
ZOHO_CLIENT_ID=...
ZOHO_CLIENT_SECRET=...
ZOHO_ACCOUNTS_URL=https://accounts.zoho.in   # the data centre where the Zoho client was created
```

Leave a pair empty to hide that provider. `PUBLIC_BASE_URL` must be the public address of the API, because the redirect URI is built from it:

```
${PUBLIC_BASE_URL}/api/v1/auth/sso/google/callback
${PUBLIC_BASE_URL}/api/v1/auth/sso/microsoft/callback
${PUBLIC_BASE_URL}/api/v1/auth/sso/zoho/callback
```

Settings → Single sign-on shows the exact redirect URIs with a copy button. `WEB_ORIGIN` (first entry) is where people are sent after signing in.

### Google (Google Cloud console)

1. Open console.cloud.google.com → choose or create a project.
2. **APIs & Services → OAuth consent screen**: user type **Internal** if everyone uses your Google Workspace (otherwise External), app name "PROJEXA", support email. Scopes: `openid`, `email`, `profile`.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**: application type **Web application**. Under **Authorised redirect URIs** add the Google redirect URI above.
4. Copy the client ID and secret into `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

### Microsoft (Microsoft Entra admin centre)

1. Open entra.microsoft.com → **Identity → Applications → App registrations → New registration**.
2. Name "PROJEXA". Supported account types: **Accounts in any organizational directory (multitenant)** if you will serve several companies, or **this organizational directory only** for just your own. PROJEXA always checks the tenant per organization.
3. Redirect URI: platform **Web**, the Microsoft redirect URI above.
4. **Certificates & secrets → New client secret**. Copy the secret **value** (not the ID) into `MICROSOFT_CLIENT_SECRET`. Note its expiry date and renew it before then.
5. Copy **Application (client) ID** into `MICROSOFT_CLIENT_ID`.
6. **API permissions**: `openid`, `email`, `profile` (Microsoft Graph, delegated) are enough. Grant admin consent if your tenant requires it.
7. Give each organization's admin their **Directory (tenant) ID** for Settings → Single sign-on.

### Zoho (Zoho API console)

1. Sign in to the API console of your data centre: api-console.zoho.com (or .in, .eu, .com.au, .jp, .ca, .sa).
2. **Add client → Server-based Applications**. Client name "PROJEXA", homepage URL your PROJEXA address, **Authorized redirect URIs**: the Zoho redirect URI above.
3. Copy the client ID and secret into `ZOHO_CLIENT_ID` and `ZOHO_CLIENT_SECRET`. Set `ZOHO_ACCOUNTS_URL` to the accounts server of that data centre, e.g. `https://accounts.zoho.in`.
4. If people with Zoho accounts in another data centre should sign in too, turn on **multi-DC** for the client under Settings in the API console. PROJEXA then follows the `accounts-server` Zoho sends back, but only to Zoho's own accounts hosts.

## Troubleshooting

The sign-in page shows the reason when single sign-on fails:

| Message | Fix |
| --- | --- |
| No PROJEXA account for … can sign in with … | Add the person as a PROJEXA user with that email, check the domain is on the list, and the provider is on. For Microsoft, check the tenant ID. |
| … sign-in is not set up on this server | Add the client ID and secret to the API environment and restart. |
| redirect_uri_mismatch (from the provider) | The redirect URI registered with the provider must match the one in Settings exactly, including `https` and no trailing slash. |
| This sign-in took too long or was started in another browser | Start again; the round trip must finish within 10 minutes in the same browser. |
| Your email is in several organizations | Open "Organization" on the sign-in page, enter the organization slug, then click the button again. |
| Your organization signs in with Google, Microsoft or Zoho | "Single sign-on only" is on; use a button instead of the password. |

## API

| Route | Who | |
| --- | --- | --- |
| `GET /api/v1/auth/sso/providers` | anyone | Providers set up on the server (the buttons). |
| `GET /api/v1/auth/sso/:provider/start?org=slug` | anyone | Redirects to the provider. |
| `GET /api/v1/auth/sso/:provider/callback` | provider | Finishes sign-in and redirects to the web app (or back to the phone app). |
| `GET /api/v1/auth/sso/:provider/start?client=mobile&redirect=projexa://sso&challenge=…` | phone app | Same sign-in, started from the app. See docs/MOBILE_APP.md → Single sign-on. |
| `POST /api/v1/auth/sso/mobile/exchange` | phone app | `{ code, verifier }` → session, or `{ mfaRequired, mfaToken }`. |
| `GET` / `PUT /api/v1/organization/sso` | admin | Settings, redirect URIs and linked accounts. |
| `DELETE /api/v1/sso-identities/:id` | admin | Unlink an account. |
