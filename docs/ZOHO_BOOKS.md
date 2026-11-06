# Zoho Books sync

> **Now set up in the app.** An admin enters the Self Client ID, secret and grant code in **Settings → Integrations**; SampTrek swaps the code for the refresh token, so the curl step below is no longer needed (see `docs/INTEGRATIONS.md`). The environment variables are an optional fallback.

SampTrek can send documents straight into **Zoho Books** through its v3 API, so nobody has to import files. It sends:

| SampTrek | Zoho Books | When |
|---|---|---|
| Client (per currency) | Customer contact | First invoice in that currency. Found by name first; created only if missing |
| Vendor (per currency) | Vendor contact | First bill in that currency. Same lookup |
| Sent or paid client invoice | Invoice with the same number, marked sent | Invoice date on or after **Sync documents from** |
| Approved or paid vendor bill | Bill with the same number, open | Approval date on or after **Sync documents from** |
| Paid invoice | Customer payment applied to the invoice | Payments turned on |
| Paid vendor bill | Vendor payment applied to the bill | Payments turned on |
| Voided invoice or bill that was synced | Invoice or bill voided | Next run |

Drafts are never sent. Credentials stay in the server environment and are never stored in the database or shown on screen.

## How a run works

- **Sync now** on the Accounting page (admins and project managers), or **Every hour** (an admin turns it on).
- Only one run at a time. A run that has not finished after 30 minutes is treated as stopped by a server restart, and the next one starts fresh.
- **Never twice.** Every contact, invoice, bill and payment that reaches Zoho Books is remembered. Before creating an invoice or bill, SampTrek also searches Zoho Books for the same number and links to it if someone already entered or imported it ("already there" in the history).
- **Problems stay per document.** A missing tax rate or a refused document is listed under the run with its number, and the run carries on with the rest. Fix the cause and the next run picks it up.
- **Rate limits.** Zoho Books allows 30 requests a minute and 1,000 a day on the free plan (2,000 to 10,000 on paid plans). SampTrek spaces requests about 2 seconds apart, waits when Zoho answers "too many requests", and stops a run after 600 requests or 500 documents; the next run continues. A new invoice takes about 3 requests, a payment 2.
- **Counts as exported.** Synced documents and payments are marked exported, so a CSV export with "only not exported yet" does not send them again.

## Mapping

- **Contacts.** Named as set under Account names (name or code). Zoho contacts have one currency, so a client billed in USD and EUR gets two contacts: `Acme Insights` (in the Zoho base currency) and `Acme Insights (EUR)`. If a contact of that name exists with another currency, the document is reported, not guessed.
- **Invoice lines.** Item name from Account names (default "Survey completes"); if Zoho Books has an item with that name it is used. Description, quantity and unit price come from the SampTrek line. Reference = project code. Our invoice number is kept (`ignore_auto_number_generation=true`).
- **Bill lines.** Expense account from Account names (must exist in the chart of accounts). Reference = the vendor's own invoice number.
- **Tax.** The tax with the same percentage in Zoho Books (Settings → Taxes), preferring the same name. If none exists the document is reported. Zoho calculates tax per line, which can differ by a cent from SampTrek's rounding.
- **Payments.** Amount = the document's balance in Zoho Books (so rounding never over-applies), date = when it was marked paid, reference = the payment reference recorded in SampTrek, account = the bank account from Account names, mode = the payment mode from Account names.
- **Currencies.** Each document currency must be enabled in Zoho Books (Settings → Currencies). When SampTrek and Zoho Books use the same base currency, your manual exchange rate is sent; otherwise Zoho Books applies its own rate.

**Test connection** (admins) signs in, shows the Zoho organisation and its currency, and checks that the bank account, the expense account and every tax rate used on SampTrek documents exist in Zoho Books.

## Server setup (once)

1. Sign in to the Zoho API console for your data centre (`api-console.zoho.com`, `.in`, `.eu`, `.com.au` or `.jp`) with a Zoho Books admin account.
2. Add a client of type **Self Client**. Note the client ID and client secret.
3. Under **Generate Code**, enter the scope `ZohoBooks.fullaccess.all`, a duration of 10 minutes and a description, then copy the code.
4. Within those minutes, exchange it for a refresh token (replace `.in` with your data centre):

   ```bash
   curl -X POST "https://accounts.zoho.in/oauth/v2/token" \
     -d grant_type=authorization_code -d client_id=1000.XXXX -d client_secret=XXXX -d code=1000.XXXX
   ```

   Keep the `refresh_token` from the answer. It does not expire unless revoked.
5. Find the organisation ID in Zoho Books under Settings → Organisation Profile.
6. Set the environment on the API server and restart it:

| Variable | Example | Meaning |
|---|---|---|
| `ZOHO_BOOKS_CLIENT_ID` | `1000.ABC…` | Self client ID |
| `ZOHO_BOOKS_CLIENT_SECRET` | | Self client secret |
| `ZOHO_BOOKS_REFRESH_TOKEN` | `1000.abc…` | From step 4 |
| `ZOHO_BOOKS_ORGANIZATION_ID` | `600000123` | Zoho Books organisation |
| `ZOHO_BOOKS_TENANT` | `frequent-research` | Slug of the one SampTrek organisation allowed to use this connection |
| `ZOHO_BOOKS_DC` | `in` | Data centre: `com` (default), `in`, `eu`, `com.au`, `jp` |
| `ZOHO_BOOKS_API_URL`, `ZOHO_BOOKS_ACCOUNTS_URL` | | Only to override the URLs derived from the data centre |
| `ZOHO_BOOKS_SCHEDULER_ENABLED` | `false` | Turns off the hourly check on this server |

7. In SampTrek: Accounting → Zoho Books sync → **Test connection**, pick **Sync documents from** (for example the first day after your last manual import), save, then **Sync now**.

`ZohoBooks.fullaccess.all` is the simplest scope. The token only reaches the one Zoho Books organisation set in `ZOHO_BOOKS_ORGANIZATION_ID`, and only the SampTrek organisation in `ZOHO_BOOKS_TENANT` can use it.

**Before the first live run** try it on a Zoho Books trial organisation. The sync follows the published Zoho Books v3 API and is tested against a simulated Zoho Books, not a live account.

## API

| Method | Path | Who |
|---|---|---|
| GET | `/accounting/zoho-books` | admin, project manager. Connection state (never secrets), settings, counts of linked records, last 20 runs |
| PUT | `/accounting/zoho-books/settings` | admin. `{ hourly, since: "YYYY-MM-DD", invoices, bills, payments }` |
| POST | `/accounting/zoho-books/test` | admin |
| POST | `/accounting/zoho-books/sync` | admin, project manager. Starts a run in the background and returns it (`status: "running"`); 409 while one runs |
