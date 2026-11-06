# Clients, vendors and redirects editing

Testing feedback from Kunal (2026-11-06) asked for edit everywhere in Clients and Vendors, real checks on
client details, a bulk add template, every redirect on vendors (not only the callback), prebuilt
Static / Dynamic / Hybrid redirects that are easy to change, and no client information in what vendors see.

## Clients

- **Edit**: every row on Clients has *Edit* (and the name is a link). It edits name, code, status,
  website, contacts and billing in one form. `PATCH /clients/:id` takes the full contact list: contacts
  with an `id` are updated, new ones added, missing ones removed (projects pointing at a removed contact
  are unlinked first). Contacts sent without an id are matched to existing ones by email, then by name.
- **Checks** (same rules in the form and the API, `apps/api/src/common/contact-fields.ts` and
  `apps/web/lib/contact-rules.ts`):
  - Website: `acme.com` or a full `http(s)://` address; saved as `https://acme.com`.
  - Contact: a name and an email or a phone. Email must look like one; phone 6–20 digits with
    `+ ( ) - . space`. Two contacts cannot share an email.
  - The **form** asks for at least one contact with an email. The API still accepts a client with no
    contacts so older integrations keep working.
  - Codes are unique per organisation; a clash is a 409 with a clear message.
- Search and status filter above the table.

## Vendors

- **Edit**: *Edit* on each row of Vendors, and *Details, redirects and callback → Edit* on the vendor page.
- **All redirects** (`Vendor.redirectUrls`, JSON keyed by outcome status):
  - Main four: Complete, Terminate, Quota full, Security / quality term.
  - Optional: Quality fail and Duplicate (empty = security URL), Partial and Technical error (empty = terminate URL).
  - URLs may use `{respondent_uid}`, `{vendor_id}`, `{country_code}`, `{project_code}`, `{status}`.
  - After the complete URL is typed, the form offers the other three by swapping the word or number
    (`…/complete` → `…/terminate`, `status=1` → `status=2`), to check with the vendor.
  - The hosts of saved redirect URLs are added to the vendor's allowed redirect domains automatically.
- Contact name, email, phone and website; callback URL (server to server) as before, now clearable.
- The list shows how many of the four redirects each vendor has, so gaps stand out.

## Bulk add (clients and vendors)

*Bulk add* on Clients and Vendors: download the CSV template (two example rows), fill it in a
spreadsheet, upload it. `POST /clients/import` / `POST /vendors/import` with `{ rows, dryRun }`:
every row is checked first (dry run, nothing saved) and the preview lists problems per row; *Add N*
then adds only the rows that passed. Up to 1000 rows. Codes are made from the name when empty.
Semicolon-separated CSV files (some locales) are read too.

Client columns: `name, code, website, contact_name, contact_email, contact_phone, billing_address, tax_id`
(name, contact name and contact email required).
Vendor columns: `name, code, website, contact_name, contact_email, contact_phone, complete_url,
terminate_url, quota_full_url, security_url, callback_url, redirect_domains` (name required).

## Redirects: prebuilt, separated by step

The project Redirects tab now starts with **How redirects work in SampTrek**, three separate steps:

1. **Vendor → SampTrek**: the vendor's entry link (Vendors & links tab). Give to the vendor.
2. **Client survey → SampTrek**: prebuilt return links, one per status, with copy buttons
   (`/r/complete?token=[TOKEN]` …). Give to the client.
3. **SampTrek → Vendor**: the status matrix below, prebuilt from each vendor's saved redirects.

The macro **`{vendor_redirect}`** stands for "this vendor's saved URL for this status". It must be the
whole URL of a rule. Prebuilt matrices use it for all eight statuses:

| Mode | Prebuilt |
| --- | --- |
| Static | vendor's URL exactly as saved (its own macros are filled, nothing added) |
| Dynamic | vendor's URL plus `uid`, `vid`, `country` (the parameter mapping) |
| Hybrid | complete, terminate, quota full dynamic; the other five static |

- New projects get the prebuilt matrix for their mode. Statuses the client's redirect template or the
  organisation default already set are left out, so they keep inheriting as before.
- Switching mode refills the prebuilt set while the matrix is still prebuilt; hand-typed links are kept.
  *Reset to prebuilt* puts it back.
- Each status has **Vendor's saved redirect / Custom URL**. Custom URLs, and the URLs of country and
  vendor overrides, are editable in place.
- When a vendor has no saved URL for a status, validation shows a warning (not an error) and those
  respondents see the SampTrek end page; effective routing says why.
- *Vendor redirects saved on each vendor* lists what every vendor on the project has, with a link to edit it.

## What vendors see

`Project.vendorTitle` (Vendors & links tab → *Name vendors see*) replaces the internal project name
everywhere a vendor looks: the vendor portal (links, respondents), quote requests, requests and
disputes. Empty means `Survey <project code>`. Staff screens keep the real name. Helper:
`apps/api/src/common/vendor-safe.ts`.

## Tests

`apps/api/test/e2e/clients-vendors-editing.e2e.spec.ts`.
