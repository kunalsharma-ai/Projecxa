# Clients and vendors: active / inactive, logos, contacts, bulk add and Add +

Kunal's feedback of 2026-11-06. Builds on [CLIENTS_VENDORS_EDITING.md](CLIENTS_VENDORS_EDITING.md).

## Active / Inactive

- Clients and Vendors lists have a one-click **Active / Inactive** switch in the Status column
  (`PATCH /clients/:id/status`, `PATCH /vendors/:id/status`; Admin, Project manager, and Sales for clients).
  The edit forms still have the status too.
- Only **active** clients and vendors are offered on Create project and when adding a vendor to a market
  (`GET /clients?status=ACTIVE`, `GET /vendors?status=ACTIVE`). The API refuses inactive ones as well
  (`CLIENT_INACTIVE`, `VENDOR_INACTIVE`).
- Existing projects keep working with a client or vendor that becomes inactive; the project shows a note.

## Logos

- Upload on the Clients and Vendors pages (new and edit), and on the vendor page. Any common image format:
  PNG, JPEG, GIF, WebP, AVIF, BMP, ICO and SVG, checked by the file's bytes, **up to 200 KB**.
- Bigger raster images are made smaller in the browser before upload (longest side 512 px, WebP or PNG),
  so people never have to resize by hand.
- SVGs with scripts, event handlers, embedded HTML or images from the internet are refused. Every logo is
  served with `nosniff` and a sandboxing CSP (`apps/api/src/parties/logos.ts`).
- Logos are kept in their own table (`PartyLogo`), so client and vendor lists stay light. Lists and project
  pages return `logoUrl` (`/clients/:id/logo?v=<hash>`); without a logo the initials show.
- Logos show next to names on the Clients and Vendors lists, in the client and vendor pickers on Create
  project and Vendors & links, on vendor rows of a project, and on the project's Overview.

## Contact person on the project, masked

- Create project shows the chosen client with its logo and the contact person; the Overview tab of a
  project shows the same under Project settings, with **Contact** to choose or add another one.
- The email is masked so the person and the company stay recognisable without showing the address:
  `pat.lee@aceresearch.com` → `p•••••e@aceresearch.com` (domain kept). Phones keep the country code and the last
  four digits. Vendor contacts on the Vendors & links tab are masked the same way (`apps/web/lib/mask.ts`).
- The full details stay on the Clients and Vendors pages.
- Changing the contact later checks it belongs to the project's client.

## Bulk add from Excel or CSV

- Clients → Bulk add and Vendors → Bulk add now take **Excel (.xlsx)** as well as CSV, and offer an Excel
  template and a CSV template. Every row is checked first; nothing is saved until **Add**. Adding one by one stays.
- Excel files are read in the browser by a small built-in reader (`apps/web/lib/xlsx.ts`, no library):
  first sheet, shared and inline strings, numbers and blank cells. Old `.xls` files get a message to save as .xlsx.
- Fixed: the API's JSON body limit was Express's default 100 KB, so an import of a few hundred rows failed.
  It is 2 MB now (`apps/api/src/bootstrap.ts`); files go as multipart with their own limits.

## Add + on forms

- **Client, contact and vendor**: on Create project and Vendors & links, type a name that is not in the list
  and choose **+ Add “…”**. A small form saves the new client (name, code, contact, logo), contact
  (name, email, phone) or vendor right away and selects it, without leaving the page
  (`apps/web/components/parties/quick-add.tsx`).
- **Lists**: category, target group (also on Add market), language and link variable (vendor rows and
  Add vendor) use the searchable dropdown with “+ Add”. What people add is saved for the whole organisation.
- **Settings → Dropdown options** (`/settings/options`) lists everything added this way, to add more, fix a
  typo (`PATCH /custom-options/:id`) or remove one. Projects keep the values they already use.

Tests: `apps/api/test/e2e/clients-vendors-links.e2e.spec.ts`, `apps/web/scripts/check-xlsx.ts`.
