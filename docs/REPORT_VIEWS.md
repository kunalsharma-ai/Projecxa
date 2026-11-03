# Saved report views and PDF export (milestone 22)

## Saved views

On **Reports**, the bar above the filters lists the views you can use: your own and those shared by colleagues.

- **Save view** stores the current tab, the date range and the client, project, vendor and market filters under a name. Tick **Share with the team** to let everyone in the organisation use it.
- Relative ranges (Today, Last 7/30/90 days, This month and so on) are stored as the range, not as dates, so a "Last 30 days" view always shows the last 30 days. A custom range keeps its two dates.
- Choosing a view applies it. Changing any filter afterwards leaves the view, so a view is never changed by accident.
- Only the owner or an admin can rename, share, unshare or delete a view. Each person can keep up to 50 views.
- Filters are checked when a view is saved: a view cannot point at a client, project or vendor of another organisation.

API: `GET/POST /api/v1/reports/views`, `PATCH/DELETE /api/v1/reports/views/:id`.

## Report PDF

**Download PDF** on the Overall, Clients and Vendors tabs downloads a landscape A4 PDF built from the same filters as the screen: the title (the view name when a view is applied), the period and filters, total tiles, and the table grouped by client or vendor with a total row. Money stays in each market's own currency and is never mixed. Long tables continue on further pages with the header repeated.

API: `GET /api/v1/reports/pdf?report=overall|client|vendor&from=&to=&clientId=&projectId=&vendorId=&countryCode=&title=&tz=`.

## Invoice PDF

**Download PDF** on a client invoice downloads it as an A4 PDF (`INV-….pdf`):

- Seller block from **Settings → Invoice details** (admins edit): legal name (defaults to the organisation name), address, tax ID, billing email, phone, payment details (bank account, IBAN/SWIFT, UPI) and a footer line.
- Bill to: the client's name, billing address and tax ID, set when the client is created or with **Billing details** on the Clients page.
- Project code, name and work order, the invoice lines per market, tax and totals, notes, and the payment reference once paid.
- Draft, void and paid invoices carry a large faint stamp so a draft is not sent by mistake.
- Dates are shown in the accounting time zone from Settings → Finance.

API: `GET /api/v1/invoices/:id/pdf`, `GET/PUT /api/v1/organization/invoice-profile`.

## Scheduled report emails

Tick **Attach PDF** on a schedule (Reports → Scheduled reports) to attach the PDF report next to the CSV.

## Fonts

PDFs embed DejaVu Sans (in `apps/api/assets/fonts`, free licence in the same folder) so names in any Latin, Greek or Cyrillic script, symbols such as ₹ and € print correctly. Set `PDF_FONT_DIR` to use the fonts from another folder; if none are found the PDFs fall back to Helvetica, which covers only basic Latin. CJK characters need a CJK font and are not included.
