# Direct sync to Xero, QuickBooks Online and Tally Prime

> **Now set up in the app.** The Xero and QuickBooks apps and the Tally address are entered in **Settings → Integrations** by the organisation that runs the server (see `docs/INTEGRATIONS.md`). Each organisation still presses Connect on the Accounting page. The environment variables are an optional fallback.

SampTrek can send client invoices, vendor bills, their payments and voids straight into Xero, QuickBooks Online or Tally Prime, the same way it already does for Zoho Books (docs/ZOHO_BOOKS.md). It is on the **Accounting** page under **Xero, QuickBooks and Tally sync**. The CSV and XML exports stay available for every system.

## What is sent

| SampTrek | Xero | QuickBooks Online | Tally Prime |
| --- | --- | --- | --- |
| Client (per currency) | Contact | Customer (one per currency; "Name (EUR)" when multicurrency is on) | Ledger under Sundry Debtors |
| Vendor | Contact | Vendor (a name already used by a customer gets " (vendor)") | Ledger under Sundry Creditors |
| Sent or paid invoice | ACCREC invoice, Authorised, income account code | Invoice with the service item from Account names (created if missing) | Sales voucher |
| Approved or paid bill | ACCPAY invoice (bill), Authorised, expense account code | Bill on the expense account | Purchase voucher |
| Invoice paid | Payment into the bank account | Payment into the bank account | Receipt voucher |
| Bill paid | Payment from the bank account | Bill payment (cheque) from the bank account | Payment voucher |
| Invoice voided | Voided (Xero refuses if it has payments) | Voided | Voucher cancelled |
| Bill voided | Voided | **Deleted** (QuickBooks has no void for bills; refused while it has payments) | Voucher cancelled |

- Only documents dated on or after **Sync documents from** are sent. Older ones are left alone.
- Every record that reaches the accounting system is remembered (`LedgerLink`). Invoices and bills are also looked up by number first, so a run can repeat any number of times without making duplicates. Xero and QuickBooks calls that create something also carry an idempotency key (`Idempotency-Key` / `requestid`).
- Synced documents count as exported, so they drop out of "only not exported yet" in the file exports.
- Each run lists its problems per document. A problem with one document does not stop the others.
- **Sync now** is for admins and project managers. **Every hour** runs it by itself (turn off for a whole server with `LEDGER_SCHEDULER_ENABLED=false`).

Account names, the Xero account codes and tax names, and the Tally voucher types and company come from **Account names** on the same page.

## Xero

1. At developer.xero.com → My Apps, create a **Web app**. Redirect URI: `https://<your API host>/api/v1/accounting/ledgers/xero/callback` (shown on the Accounting page).
2. Set on the API server:

   ```
   XERO_CLIENT_ID=...
   XERO_CLIENT_SECRET=...
   ```

3. An admin opens Accounting → Xero → **Connect Xero**, signs in to Xero and picks the organisation.

Notes (checked 2026-11-02):

- Scopes: `offline_access accounting.contacts accounting.invoices accounting.payments accounting.settings.read`. These are Xero's granular scopes, required for apps created from 2 March 2026. An app created earlier that still uses the broad scopes can set `XERO_SCOPES` (for example `offline_access accounting.contacts accounting.transactions accounting.settings.read`) until it moves over (Xero's deadline: 13 September 2027).
- Access tokens last 30 minutes. Refresh tokens last 60 days and change on every refresh; SampTrek saves each new one at once. If nobody syncs for 60 days, an admin has to connect again (the tab shows "Sign in again").
- Limits: 60 calls a minute and 5,000 a day per Xero organisation. On Xero's free developer tier (Starter) the app gets 5 connections and 1,000 calls a day per organisation. SampTrek spaces calls about a second apart and stops a run at 300 calls; the next run carries on.
- Foreign-currency documents need the currency added in Xero (Settings → Currencies), which needs a Xero plan with multi-currency. Xero applies its own daily exchange rate.
- Taxed lines use the Xero tax rate with the document's tax name, then the names under Account names, then any rate with the same percentage. Untaxed lines use the "no tax" name from Account names.

## QuickBooks Online

1. At developer.intuit.com, create an app with the **Accounting** scope. Add the redirect URI `https://<your API host>/api/v1/accounting/ledgers/quickbooks/callback`.
2. Set on the API server:

   ```
   QUICKBOOKS_CLIENT_ID=...
   QUICKBOOKS_CLIENT_SECRET=...
   # sandbox while testing; leave out for real companies
   QUICKBOOKS_ENVIRONMENT=sandbox
   ```

3. An admin opens Accounting → QuickBooks Online → **Connect QuickBooks Online** and picks the company.

Notes (checked 2026-11-02):

- Calls use minor version 75 (the only one Intuit accepts since August 2025); `QUICKBOOKS_MINOR_VERSION` changes it.
- Access tokens last an hour. Refresh tokens rotate and, since Intuit's 2026 change, have a maximum life of five years; Intuit emails a warning before one ends. SampTrek saves every new token.
- Limits: 500 calls a minute per company. SampTrek stops a run at 2,000 calls.
- Foreign currencies need **multicurrency** turned on in QuickBooks (it cannot be turned off again). The exchange rate is SampTrek's (Settings → Finance) when both use the same home currency, otherwise QuickBooks's.
- Taxed documents need a QuickBooks tax code with the same name as the tax in SampTrek (for example "GST"). US companies with automated sales tax should leave tax off in SampTrek and let QuickBooks calculate it.
- Document numbers longer than 21 characters are refused by QuickBooks.

## Tally Prime

Tally Prime has no cloud API. It answers XML on its own computer (port 9000 by default), with **no password**, so it must never be opened to the internet.

1. In Tally Prime: F1 (Help) → Settings → Connectivity → "TallyPrime acts as" **Server** (or Both), port 9000. Keep the company open.
2. Make that port reachable from the SampTrek server only, for example over a site-to-site VPN or a private tunnel.
3. Set on the API server:

   ```
   TALLY_URL=http://10.0.0.15:9000
   # the SampTrek organisation (slug) that owns this Tally
   TALLY_TENANT=demo
   ```

Notes:

- Amounts are in SampTrek's reporting currency, using the rates in Settings → Finance (the same as the Tally export). A document in a currency without a rate is reported, not sent.
- Party ledgers are created under the groups in Account names; ones that already exist are reused. Income, expense, tax and bank ledgers must already exist in Tally with the names in Account names.
- Tally cannot be asked "is this voucher already here?" through this interface. SampTrek relies on what it has sent, so do not also import the same documents from an exported file.
- A voided document cancels the voucher by the id Tally reported when it was created.
- **Test connection** lists the open companies and checks the one named in Account names.

## Security

- Client IDs, secrets and the Tally URL live in the server environment only.
- Xero and QuickBooks tokens are stored encrypted (AES-256-GCM) with `ACCOUNTING_ENCRYPTION_KEY` (falls back to `MFA_ENCRYPTION_KEY`, then `JWT_SECRET`). They are never sent to the browser. Set a separate key so rotating the others does not disconnect anybody.
- Only admins connect, disconnect, test or change settings. Disconnecting asks Xero or Intuit to revoke the token.
- The OAuth `state` is checked against a signed cookie that lasts 10 minutes, and the person finishing the sign-in must still be an active admin.
- Connecting, disconnecting, settings changes and every run are in the audit log.

## API

All under `/api/v1/accounting/ledgers`, signed-in staff:

| Method | Path | Who | |
| --- | --- | --- | --- |
| GET | `/` | Admins, PMs | Status of each system, settings and the last 20 runs |
| GET | `/:provider/connect` | Admin | Opened in the browser; redirects to Xero or Intuit |
| GET | `/:provider/callback` | (public) | Where Xero or Intuit send the browser back |
| PUT | `/:provider/settings` | Admin | `{ hourly, since, invoices, bills, payments }` |
| POST | `/:provider/test` | Admin | Connection and account checks |
| POST | `/:provider/sync` | Admins, PMs | Starts a run in the background |
| DELETE | `/:provider` | Admin | Disconnect (Xero, QuickBooks) |

`provider` is `xero`, `quickbooks` or `tally`.

## Testing

`apps/api/test/e2e/ledgers.e2e.spec.ts` runs the sign-in, sync, matching, voids, payments, token rotation and expiry against simulated Xero, QuickBooks and Tally servers. Nothing was tested against the real services, so connect a Xero demo company, a QuickBooks sandbox company and a copy of a Tally company first.
