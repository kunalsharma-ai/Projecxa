# Work order numbers and the UID prefix

Asked for by Kunal on 2026-11-06: a prefix for work orders, generated automatically or typed by hand,
showing the previous one and editable later; and a custom prefix on respondent UIDs for branding.

## Settings → Work orders and UID prefix

Everyone on staff sees it; admins change it (`GET`/`PUT /api/v1/numbering`).

- **Work order prefix**: 1–12 letters or digits; `-`, `_` and `/` are allowed after the first one
  (e.g. `FR`, `WO-`). Default `WO`.
- **Next number**: the number the next generated work order gets. Setting it to a number already used by a
  project is refused (409).
- **Last work order given**: the latest one, generated or typed (`Organization.lastWorkOrderNo`).
- **UID prefix**: optional, up to 12 URL-safe characters (e.g. `SMP-`). Every new respondent's UID
  (the session token the client survey receives) starts with it: `SMP-q8xT…`. Respondents who already
  entered keep their UID. The preview shows what the client survey receives.

## Create project

The Work order field shows `Next: FR9132` and `last one: FR9131`.

- **Generate** ticked and the field empty: the next free number is given on save
  (`takeWorkOrder` in `apps/api/src/numbering/numbering.ts`). Numbers somebody already typed by hand are skipped.
- **Typed by hand**: it must not be used by another project in the organisation (case-insensitive; 409
  `WORK_ORDER_TAKEN`). When it is the prefix plus a number past the counter (e.g. `FR9140`), the counter
  moves on, so the next generated one is `FR9141`.
- **Later**: Overview → Project settings → Work order has an edit pencil (`PATCH /projects/:id { workOrderNo }`),
  with the same uniqueness check.

Tests: `apps/api/test/e2e/clients-vendors-links.e2e.spec.ts`.
