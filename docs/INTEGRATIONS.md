# Integrations (Settings → Integrations)

Every integration is set up by an admin in the app at **Settings → Integrations** (`/settings/integrations`). Nobody has to edit server files or restart anything. Each card has the fields, step-by-step help with links to where each key comes from, the redirect URI to copy, and a **Test connection** button.

| Integration | Who sets it | What the test checks |
| --- | --- | --- |
| Email sending (Zoho Mail SMTP) | Each organisation's admin | Signs in to the SMTP server and sends a test email to you |
| Sign in with Google / Microsoft / Zoho | Admins of the organisation that runs the server | Asks the provider's token endpoint whether it accepts the client ID and secret |
| AI copilot and voice (Google Gemini) | Each organisation's admin | The key is accepted and the chosen models are available to it |
| Zoho Books | Each organisation's admin | Refreshes the token and finds the Books organisation |
| Xero, QuickBooks Online | Admins of the organisation that runs the server (the app); each organisation then presses Connect on the Accounting page for its own company | Asks Xero/Intuit whether they accept the client ID and secret |
| Tally Prime | Admins of the organisation that runs the server only | Lists the companies open in Tally |
| SampBidx link | Each organisation's admin | – |
| Push notifications (phone app, Expo) | Admins of the organisation that runs the server | Sends a test push to your own phones that are signed in to the app |
| IP and proxy reputation (fraud checks) | Each organisation's admin | Says which free IP lists are loaded, and asks proxycheck.io whether it accepts the free key. See [FRAUD_CHECKS.md](FRAUD_CHECKS.md) |

Captcha keys, the SampBidx webhook secret, alert webhooks and API keys were already set in the app (Settings, and Settings → API and webhooks).

The SAMPLEON connection (audiences from the SUPPLY360 panels) is set on the server for now; see [SAMPLEON_INTEGRATION.md](SAMPLEON_INTEGRATION.md).

## Who "runs the server"

Sign-in and Xero/QuickBooks apps are one per SampTrek server (one OAuth app serves every organisation), and Tally reaches a private office network. These are set by the admins of the **server owner organisation**: the one with `Organization.platformOwner = true`, or the oldest organisation when none is marked. The migration marks the oldest one. Admins of other organisations see the status and a note instead of the form.

For the same reason, only the server owner can point the SMTP server at a private address in production.

## Zoho Books without curl

Paste the Self Client ID and secret, then the **grant code** from the API console's Generate Code tab (scope `ZohoBooks.fullaccess.all`, 10 minutes). On save SampTrek swaps the code for a refresh token and fills in the Books organization ID when your Zoho login has only one. The binding to `ZOHO_BOOKS_TENANT` is no longer needed: settings saved in the app belong to the organisation that saved them.

## How secrets are kept

- Secret fields (passwords, client secrets, API keys, refresh tokens) are encrypted with AES-256-GCM before they are stored (`IntegrationSetting.secrets`) and are never sent back to the browser. Leave a secret empty to keep the saved one.
- The audit log records who saved, tested or removed an integration and which fields changed, never the values.
- Changing a setting clears its last test result.

## Old environment variables still work

If an organisation has not saved an integration in the app, the old variables apply as before (`SMTP_*`, `GOOGLE_*`, `MICROSOFT_*`, `ZOHO_CLIENT_*`, `GEMINI_API_KEY`/`AI_*`, `ZOHO_BOOKS_*`, `XERO_*`, `QUICKBOOKS_*`, `TALLY_*`). The card then shows **Server settings**. Saving in the app takes over; **Remove** goes back to the server settings. Existing servers keep working without changes. URL overrides used only for testing (`*_API_URL`, `*_TOKEN_URL`, `GEMINI_API_URL`) and `XERO_SCOPES` stay env-only.

## What stays on the server

Only what SampTrek needs before anyone can sign in:

| Variable | Why |
| --- | --- |
| `DATABASE_URL` | Where the database is |
| `JWT_SECRET` | Signs sign-in sessions |
| `MFA_ENCRYPTION_KEY` | Master key for saved secrets (integrations, accounting tokens, authenticator apps). Set it once and never change it. `INTEGRATIONS_ENCRYPTION_KEY` and `ACCOUNTING_ENCRYPTION_KEY` can override it, but are optional |
| `PUBLIC_BASE_URL` | Public address of the API, used in links and redirect URIs |
| `WEB_ORIGIN` | Address of the web app |
| `NEXT_PUBLIC_API_URL` (web) | Where the web app finds the API |

Background job switches (`*_SCHEDULER_ENABLED`, `MONITOR_ENABLED`, `CALLBACK_WORKER_ENABLED`) default to on and only need setting to run several API instances; see `apps/api/.env.example`.

## API

All admin-only, under `/api/v1/integrations/settings`:

- `GET /` – every integration with status, help steps, non-secret values and which secrets are set
- `PUT /:kind` – `{ values: { FIELD: "value" | "" | null } }`; empty keeps a secret, `null` removes it
- `DELETE /:kind` – remove the saved settings (falls back to the server env)
- `POST /:kind/test` – `{ ok, message, integration }`

Kinds: `smtp`, `sso_google`, `sso_microsoft`, `sso_zoho`, `gemini`, `zoho_books`, `xero`, `quickbooks`, `tally`, `bidzo` (the SampBidx link; the kind keeps its old name, see docs/SAMPBIDX_INTEGRATION.md).
