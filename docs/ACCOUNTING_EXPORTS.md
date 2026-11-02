# Accounting exports

**Accounting exports** (`/accounting`, admins and project managers) turns client invoices and vendor bills into files your accounting system imports: Zoho Books, Tally Prime, QuickBooks Online, Xero, or a general journal CSV for anything else.

## What goes in

| Documents | Included | Never included |
|---|---|---|
| Client invoices | Sent and/or Paid | Drafts (they can still change), Void |
| Vendor bills | Approved and/or Paid | Drafts, Void |

Filters: date range (invoice date = when it was sent; bill date = when it was approved; dates read in the timezone set under Account names), status, one currency, and **only documents not exported yet** (on by default).

Each export marks its documents as exported and is kept in **Export history**, so the same file can be downloaded again. With "only not exported yet" on, two people exporting at the same moment never get the same documents. Turning it off lets you export again (for example after a failed import); the preview warns that importing twice can create duplicates.

Payments are not exported. Record them in the accounting system, or let it match bank lines.

## Formats

| System | File | Documents | How to import |
|---|---|---|---|
| Zoho Books | CSV, one row per line item | Invoices or bills (separate files) | Sales → Invoices → Import Invoices; Purchases → Bills → Import Bills. Map the columns in the wizard if Zoho asks. |
| Tally Prime | XML (`ENVELOPE` / `IMPORTDATA`, Sales and Purchase vouchers) | Invoices, bills or both | Gateway of Tally → Import → Transactions, choose the file. |
| QuickBooks Online | CSV | Invoices or bills | Settings → Import data → Invoices. The bills file uses a common bill layout for bill import tools. |
| Xero | CSV in Xero's import template (28 columns) | Invoices or bills | Business → Invoices → Import; Business → Bills to pay → Import. |
| General journal | CSV with Debit and Credit columns | Invoices, bills or both | For other systems or your accountant. Each document balances. |

Notes per format:

- **Tax**: invoices and bills carry one tax (name and percent) on the subtotal. CSV formats put the tax name and percent on each line; the target system recalculates tax, which can differ by a cent from PROJEXA's rounding. Xero gets `TaxAmount` per line so totals match.
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
| Item name | Survey completes | Zoho Books, QuickBooks |
| Customers and vendors by | Name | All |
| Date format | 2026-10-31 | CSV formats |
| Timezone for dates | Asia/Kolkata | All (date filter and document dates) |
| Xero account codes and tax rates | 200, 310, Tax on Sales, Tax on Purchases, Tax Exempt | Xero |
| Tally company, voucher types, groups | open company, Sales, Purchase, Sundry Debtors, Sundry Creditors | Tally |

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

Body for preview and export: `{ format, kind: invoices|bills|both, from?: "YYYY-MM-DD", to?, invoiceStatuses?: ["SENT","PAID"], billStatuses?: ["APPROVED","PAID"], onlyNew?: true, currency?: "USD" }`. Up to 5,000 documents per export.
