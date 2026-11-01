# Reconciliation, invoicing and the finance dashboard

## Reconciliation

Clients confirm which completes they accept. In **Project → Reconcile & invoice**, an editor pastes the client's IDs (one per line, or loads a CSV/TXT; the first column is used and a header row is ignored).

IDs are matched against the project's live completes:

1. by **session token** (the respondent ID the client survey received), then
2. by **vendor UID**, when exactly one complete has it. A UID shared by several completes is reported as ambiguous.

| Mode | Effect |
| --- | --- |
| `final_list` | Listed completes are approved; every other complete is rejected. |
| `approve_listed` | Listed completes are approved; others are unchanged. |
| `reject_listed` | Listed completes are rejected; others are unchanged. |

The preview (`POST /api/v1/projects/:id/reconciliation/preview`) changes nothing. It returns matched, to approve, to reject, unchanged, locked, unknown IDs (sample of 50), ambiguous UIDs, listed IDs we recorded with another outcome (e.g. terminate), and approved revenue per currency after the change. Applying (`POST /api/v1/projects/:id/reconciliation`) runs the same calculation inside one transaction, stores a `Reconciliation` record and writes the audit event `project.reconcile`.

Completes that are already on an invoice are **locked**: reconciliation, manual approval and the client portal never change them. Vendor callbacks are not re-sent when an approval changes.

## Invoices

`POST /api/v1/projects/:id/invoices` bills every approved, not yet invoiced live complete of the project. It creates one **draft** per currency, with a line per market and unit price (the complete's recorded revenue). Numbers are `INV-<year>-<5-digit sequence>` per organisation. If two people create invoices at once, the second request is rolled back with `409`.

| From | To | Effect |
| --- | --- | --- |
| DRAFT | SENT | `issuedAt` = now, `dueAt` = now + `dueDays` (default 30, max 180). A `CLOSED` project becomes `INVOICED`. |
| DRAFT, SENT | VOID | Its completes are released and can be billed again. |
| SENT | PAID | `paidAt` = now. |

Notes can only be edited on a draft. A sent invoice past its due date is shown as **overdue**. Writes need the admin or project manager role. The invoice page prints cleanly (only the invoice is printed), so "Save as PDF" in the browser gives a PDF.

| Method | Path |
| --- | --- |
| GET | `/api/v1/projects/:id/reconciliation` (approval and billing buckets per currency, last 20 runs) |
| GET | `/api/v1/invoices?status=&projectId=&clientId=` |
| GET | `/api/v1/invoices/:id` |
| PATCH | `/api/v1/invoices/:id` `{ status?, dueDays?, notes? }` |

## Dashboard

`GET /api/v1/dashboard?from=YYYY-MM-DD&to=YYYY-MM-DD` (default: the last 30 UTC days, at most two years) adds:

- `period`: revenue, cost, profit, clicks and completes for the range and for the previous range of the same length, with the change in percent (`null` when the previous range is empty). Same rules as the reports: sessions by start date, revenue from completes that are not rejected.
- `finance` (all time, in completes and revenue per currency): reconciled, awaiting reconciliation, invoice pending (approved and not invoiced, or on a draft), invoiced (sent) and payment received (paid).
- `top`: five vendors, projects and clients by revenue in the range.

`GET /api/v1/dashboard/series?from&to&interval=day|week|month` returns revenue, payout, profit, completes and clicks per bucket, with empty buckets filled with zero. Weeks start on Monday (UTC). The reports API also accepts `groupBy=week` and `groupBy=month`.

Money is summed in each market's own currency until FX conversion exists. Tiles and invoices keep currencies apart. Sums that mix currencies are marked with an asterisk.
