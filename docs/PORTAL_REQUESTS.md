# Portal requests, files and invoices (milestone 26)

Adds three things to the client and vendor portals (spec modules 8 and 9): requests (tickets) with disputes, shared files, and client invoices. Code lives in `apps/api/src/requests/`.

## Requests

A request belongs to one client or one vendor. It is numbered per organisation as `REQ-n`.

### Kinds

| Kind | Who can open it |
|---|---|
| `QUESTION` | Portal users and staff |
| `ISSUE` | Portal users and staff |
| `DISPUTE` | Vendors only |

### Status

| Status | Staff screen | Portal | Set when |
|---|---|---|---|
| `OPEN` | Waiting for us | Waiting for reply | Opened from a portal, or a portal user replies. A portal reply reopens a closed request. |
| `ANSWERED` | Answered | Answered | Staff reply |
| `CLOSED` | Closed | Closed | Staff close it, or the portal user closes their own request |

An internal note (staff only) does not change the status and is never returned to a portal.

### Owner

A request from a portal is assigned to the project's manager when it names a project. Staff can change the owner.

### Email

Sent through the Zoho Mail SMTP settings (`SMTP_*`). If SMTP is not configured, nothing is sent and nothing fails.

- A message from a portal goes to the owner, or to the project manager.
- A staff reply goes to the person who opened the request.

### Bell

The bell shows how many requests are waiting for staff, and says when any of them are disputes.

### Disputes

1. In the vendor portal, a vendor uses Requests → New request → Dispute rejected completes, or the link on its home page.
   - It picks its own completes that the client rejected.
   - The completes must be from one project, not invoiced, and not already in an open dispute.
   - `GET /portal/vendor/disputable` lists them.
2. Staff open the dispute and choose **Approve these completes** or **Keep them rejected**, with an optional message.
   - Approving changes `approval` to `APPROVED` for the disputed completes that are still rejected and not invoiced.
   - Either way the request closes, the vendor sees the decision as a reply, and the audit log records `request.dispute-decision`.

## Shared files

Files are stored in the database (`SharedFile`, 10 MB each). Each file is shared with one client, one vendor, or staff only.

- **Allowed types:** PDF, Word, Excel, PowerPoint, CSV, text, PNG, JPEG, ZIP and SPSS `.sav`.
  - The first bytes must match the extension.
  - HTML, SVG and scripts are refused.
- **Downloads** are served as attachments with `nosniff` and a `default-src 'none'` CSP. Each download is audit-logged.

| Who | Can upload | Sees |
|---|---|---|
| Client portal | Questionnaires, other files (optionally on one of its non-draft projects) | Its own uploads and files staff shared with that client |
| Vendor portal | Compliance documents (with "valid until"), other files | Its own uploads and files staff shared with that vendor |
| Staff | Any kind. On a project they share with the project's client, a vendor working on it, or staff only. | Everything in the organisation |

- **Removing files:** portal users can remove only their own uploads.
- **Where staff manage files:** each project's **Files & requests** tab, and each vendor's **Compliance documents** section.
- **Expiry warnings:** compliance documents that have expired or expire within 30 days appear in the bell.
- **Files on a request** take that request's client or vendor.

## Client invoices

`GET /portal/client/invoices` lists the client's `SENT` and `PAID` invoices; `GET /portal/client/invoices/:id/pdf` returns the same PDF staff download. Drafts and voided invoices are never shown. Vendors already see their approved and paid bills (milestone 11).

## API

| Endpoint | Who |
|---|---|
| `GET /requests`, `GET /requests/:id` | Staff |
| `POST /requests`, `POST /requests/:id/messages` (`internal` for notes), `PATCH /requests/:id` (`status`, `assigneeId`), `POST /requests/:id/dispute` (`APPROVE` or `KEEP_REJECTED`) | Editors |
| `GET /files?projectId&vendorId&clientId&kind`, `GET /files/:id/download`, `GET /files/compliance/expiring` | Staff |
| `POST /files` (multipart: `file`, `kind`, `projectId`, `clientId` or `vendorId`, `note`, `expiresAt`), `DELETE /files/:id` | Editors |
| `GET/POST /portal/requests`, `GET /portal/requests/:id`, `POST /portal/requests/:id/messages`, `POST /portal/requests/:id/close` | Client and vendor users |
| `GET/POST /portal/files`, `GET /portal/files/:id/download`, `DELETE /portal/files/:id` | Client and vendor users |
| `GET /portal/vendor/disputable` | Vendor users |
| `GET /portal/client/invoices`, `GET /portal/client/invoices/:id/pdf` | Client users |

## Not built yet

- Vendor self-registration.
- Feasibility and CPI quote requests to vendors.
- RFQs, which stay in SampBidx.

Migration: `20261102141402_portal_requests_files`.
