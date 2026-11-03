# Vendor sign-up and quote requests (Milestone 27)

## Vendor sign-up link

Admins create one sign-up link per organization at **Vendors → Applications** (`/vendors/applications`). The link looks like `https://<web>/join/<token>`. Rotating it makes the old link stop working; removing it turns sign-up off.

The public form asks for company, website, contact, email, phone, countries, panel size, audiences (specialties) and a message.

Protection, all free and self-hosted:

- A small maths question signed by the server (`nonce.ts.sig`), valid for 30 minutes, which must not be answered in under 3 seconds.
- A hidden `homepage` field (honeypot). If it is filled, the form says "thanks" and stores nothing.
- At most 5 applications per hour per IP address. Only a hash of the IP is kept, used to flag several applications from the same network.
- A second pending application with the same email is accepted quietly and not stored twice.
- No email is sent to an applicant before staff approve, so the form cannot be used to send mail to strangers.
- The applicant's website is **not** added to the redirect allowlist.

Staff see each application with a warning when it looks like an existing vendor or shares a network with another application. Project managers and admins can:

- **Approve**: creates the vendor with a vendor code, a new callback secret and capacity rows for each country. Optionally it creates a vendor portal login and sends an invite email (Zoho Mail SMTP) to set a password.
- **Reject**: with an optional reason kept for staff.

The bell shows how many applications are waiting.

## Quote requests (feasibility and CPI)

On a project's **Vendors** tab, each market has **Ask for quotes**. Pick active vendors that are not yet allocated to that market, and set completes wanted, LOI, IR, target group, a note and a reply-by date. Each vendor's portal users get an email.

Vendors answer at **Portal → Quotes** (`/portal/quotes`) with CPI, currency, feasible completes, days needed and a note, or decline. They can change an answer until staff accept it. Vendors never see the client, the client CPI or other vendors' quotes.

Staff see all quotes for the market side by side with the margin against the client CPI. **Accept** adds the vendor allocation at the quoted CPI, with a target of the smaller of feasible and wanted completes, and emails the vendor. **Close** ends a request without accepting it. A declined or closed request can be asked again.

The bell shows quotes that are waiting for review per project.

## API

| Method | Path | Who |
| --- | --- | --- |
| GET | `/api/public/vendor-signup/:token` | anyone (form and challenge) |
| POST | `/api/public/vendor-signup/:token` | anyone (rate limited) |
| GET | `/api/vendor-applications?status=` | staff |
| GET/PUT/DELETE | `/api/vendor-applications/link` | staff read, admin change |
| POST | `/api/vendor-applications/:id/approve` | admin, project manager |
| POST | `/api/vendor-applications/:id/reject` | admin, project manager |
| GET/POST | `/api/projects/:projectId/countries/:countryId/quotes` | staff |
| POST | `/api/quotes/:id/accept`, `/api/quotes/:id/close` | admin, project manager |
| GET | `/api/portal/vendor/quotes?status=` | vendor portal |
| POST | `/api/portal/vendor/quotes/:id` | vendor portal (quote or decline) |

Data: `Organization.vendorSignupToken`, `VendorApplication`, `QuoteRequest` (one per market and vendor). Migration `20261102150000_vendor_signup_quotes`.

Tests: `apps/api/test/e2e/vendor-signup-quotes.e2e.spec.ts`.
