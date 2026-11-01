# Vendor payables, tax and reporting currency

## Vendor bills

What you owe vendors comes from their **approved** completes. The payout per complete is the vendor link's CPI at the moment the complete was recorded (`RespondentSession.payout`). Rejected completes are never paid; completes still waiting for client approval are shown but cannot be billed.

**Vendor payables** (`/payables`) shows, per vendor and currency:

| Column | Meaning |
|---|---|
| Waiting approval | Completes the client has not approved yet |
| Approved, not billed | Ready for a bill |
| On drafts | On a draft bill |
| Due | On an approved bill that is not paid |

**Create bill** (one vendor) or **Bill all vendors** collects every approved, unbilled complete into one draft per vendor and currency, across projects, with a line per project, market and unit price. "Completes up to" limits it to completes recorded on or before that day, for month-end runs.

A bill moves:

- **Draft**: tax and notes can change.
- **Approved for payment**: records the vendor's own invoice number and the payment terms (due date). From here the vendor sees it in the portal under **Statements**.
- **Paid**: records the payment reference.
- **Void** (from draft or approved): releases its completes so they can be billed again.

Every change is checked against the status that was read (two people cannot approve and void the same bill at once), and completes are linked to a bill only if they are still unbilled, so the same complete is never billed twice.

Bill numbers are `BILL-<year>-<sequence>` per organisation.

## Tax

Settings → **Finance: currency and tax** sets a default tax for client invoices and for vendor bills, as a name (GST, VAT) and a percentage. New drafts get it; each draft can change or remove it (0%). Documents show subtotal, tax and total; the tax is rounded to cents once on the subtotal.

Invoices created before this milestone have no tax (`subtotal = total`).

## Reporting currency and exchange rates

Documents always stay in the market's currency. The reporting currency (default USD) is used to add up money across currencies on:

- the command center's reconciliation, invoicing and payables tiles (`≈ USD … total`);
- the Vendor payables tiles.

Rates are entered by hand in Settings: `1 <currency> = <rate> <reporting currency>`. There is no paid exchange-rate feed. When a currency has no rate, its amounts are left out of the converted total and the screen says which currency is missing. Settings lists the currencies your projects use that still need a rate.

Report tables (Reports page, top 5 lists) still sum per currency.

## API

| Method | Path | Who |
|---|---|---|
| GET | `/payables/summary` | staff |
| POST | `/payables/bills` `{ vendorId?, upTo?: "YYYY-MM-DD", notes? }` | admin, project manager |
| GET | `/payables/bills?status&vendorId`, `/payables/bills/:id` | staff |
| PATCH | `/payables/bills/:id` `{ status?: APPROVED\|PAID\|VOID, dueDays?, vendorReference?, paymentReference?, notes?, taxName?, taxPercent? }` | admin, project manager |
| PATCH | `/invoices/:id` also takes `{ taxName?, taxPercent? }` on drafts | admin, project manager |
| GET / PUT | `/organization/finance-settings` `{ baseCurrency?, invoiceTax?, billTax?, rates? }` | staff read, admin write |
| GET | `/portal/vendor/bills`, `/portal/vendor/bills/:id` (approved and paid only) | vendor portal users |
