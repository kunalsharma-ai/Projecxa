# Accounting exports

**Accounting exports** (`/accounting`, admins and project managers) turns client invoices, vendor bills and their payments into files your accounting system imports: Zoho Books, Tally Prime, QuickBooks Online, Xero, or a general journal CSV for anything else. Zoho Books can also be synced directly, without files: see `docs/ZOHO_BOOKS.md`.

## What goes in

| Documents | Included | Never included |
|---|---|---|
| Client invoices | Sent and/or Paid | Drafts (they can still change), Void |
| Vendor bills | Approved and/or Paid | Drafts, Void |

Filters: date range (invoice date = when it was sent; bill date = when it was approved; dates read in the timezone set under Account names), status, one currency, and **only documents not exported yet** (on by default).

Each export marks its documents as exported and is kept in **Export history**, so the same file can be downloaded again. With "only not exported yet" on, two people exporting at the same moment never get the same documents. Turning it off lets you export again (for example after a failed import); the preview warns that importing twice can create duplicates.

### Payments

Choose **Payments received** (paid client invoices) or **Payments made** (paid vendor bills) for Zoho Books, Tally or the general journal. One payment per paid document, for its full total:

- Filtered by the date it was marked paid, not the document date.
- The payment reference recorded when marking it paid (bank transfer ID, UTR) goes in the reference column.
- Payments are marked exported separately: exporting an invoice does not count as exporting its payment, and the other way round.

| System | Payments received | Payments made |
|---|---|---|
| Zoho Books | CSV for Sales → Payments Received → Import: date, customer, payment mode, deposit to (bank account), amount, reference, invoice number, amount applied, currency | CSV for Purchases → Payments Made → Import: vendor, paid through, bill number, amount applied |
| Tally Prime | Receipt vouchers: debit bank, credit the client ledger | Payment vouchers: debit the vendor ledger, credit bank |
| General journal | Debit bank, credit receivables | Debit payables, credit bank |

QuickBooks and Xero payment imports are not offered: both match payments from bank feeds instead.

## Formats

| System | File | Documents | How to import |
|---|---|---|---|
| Zoho Books | CSV, one row per line item | Invoices or bills (separate files) | Sales → Invoices → Import Invoices; Purchases → Bills → Import Bills. Map the columns in the wizard if Zoho asks. |
| Tally Prime | XML (`ENVELOPE` / `IMPORTDATA`, Sales and Purchase vouchers) | Invoices, bills or both | Gateway of Tally → Import → Transactions, choose the file. |
| QuickBooks Online | CSV | Invoices or bills | Settings → Import data → Invoices. The bills file uses a common bill layout for bill import tools. |
| Xero | CSV in Xero's import template (28 columns) | Invoices or bills | Business → Invoices → Import; Business → Bills to pay → Import. |
| General journal | CSV with Debit and Credit columns | Invoices, bills or both | For other systems or your accountant. Each document balances. |

Notes per format:

- **Tax**: invoices and bills carry one tax (name and percent) on the subtotal. CSV formats put the tax name and percent on each line; the target system recalculates tax, which can differ by a cent from SampTrek's rounding. Xero gets `TaxAmount` per line so totals match.
- **Tally amounts are in the reporting currency** (Settings → Finance). Documents in other currencies are converted with your manual exchange rates, and the narration keeps the original amount and rate. Without a rate for a currency the export is refused and the preview says which rate to add. Tally's sign rule is used: debit amounts are negative.
- **Tally ledgers**: client and vendor ledgers must exist in Tally with the same names, or turn on "Create client and vendor ledgers" to include them (under Sundry Debtors and Sundry Creditors, or the groups you set).
- **Customer and vendor names** must match the contacts in the accounting system. Choose names or codes under Account names.
- CSV cells that start with `=`, `+`, `-` or `@` are prefixed with `'` so spreadsheets never run them as formulas. Files are UTF-8 with a byte-order mark so Excel shows accents correctly.

## Account names

**Account names** (button on the page; admins edit, project managers can read):

| Setting | Default | Used by |
|---|---|---|
| Income account | Sales | All formats (Tally sales ledger) |
| Expense account | Cost of Goods Sold | All formats (Tally purchase ledger) |
| Tax on sales / purchases account | Output Tax / Input Tax | Tally, journal |
| Receivables / payables account | Accounts Receivable / Accounts Payable | Journal |
| Bank account | Bank | Payments (all formats), Zoho Books sync |
| Payment mode | Bank Transfer | Zoho Books payments and sync |
| Item name | Survey completes | Zoho Books, QuickBooks |
| Customers and vendors by | Name | All |
| Date format | 2026-10-31 | CSV formats |
| Timezone for dates | Asia/Kolkata | All (date filter and document dates) |
| Xero account codes and tax rates | 200, 310, Tax on Sales, Tax on Purchases, Tax Exempt | Xero |
| Tally company, voucher types, groups | open company, Sales, Purchase, Receipt, Payment, Sundry Debtors, Sundry Creditors | Tally |

## API

| Method | Path | Who |
|---|---|---|
| GET | `/accounting/formats` | staff |
| GET | `/accounting/settings` | staff |
| PUT | `/accounting/settings` | admin |
| POST | `/accounting/exports/preview` | admin, project manager |
| POST | `/accounting/exports` | admin, project manager |
| GET | `/accounting/exports` | admin, project manager |
| GET | `/accounting/exports/:id/download` | admin, project manager |

Body for preview and export: `{ format, kind: invoices|bills|both|payments_received|payments_made, from?: "YYYY-MM-DD", to?, invoiceStatuses?: ["SENT","PAID"], billStatuses?: ["APPROVED","PAID"], onlyNew?: true, currency?: "USD" }`. Up to 5,000 documents per export.
