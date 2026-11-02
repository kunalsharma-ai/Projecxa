# Project templates, drafts and settings history (milestone 23)

## Templates

A template is a reusable project setup. Make one from any project with **Save as template** on the project page; find them all under **Projects → Templates** (`/projects/templates`).

A template keeps:

- project type, category, description, devices, security and quality checks, redirect mode;
- every market with its language, currency, LOI, IR, CPI, completes, target group and session lifetime. Values that are the same in every market become shared settings, the rest stay on their market, exactly like the Create project form;
- gate survey and prescreener questions, human check style, respondent page design and fieldwork autopilot;
- the redirect rules and parameter mappings of the active redirect version.

Optional, chosen when saving:

| Option | Default | Notes |
| --- | --- | --- |
| Quota cells | on | Targets and conditions per market. Counts start at zero. |
| Vendors and their CPI | on | New entry links are made for each new project; codes are never reused. |
| Client | off | Leave off to reuse the setup for any client. |
| Survey links | off | Usually different for every project. |

**Using a template**: on Create project, pick it under **Start from**, or press **Use template**. The form is filled in; change anything before you create the project. When you create it, the questions, page design, autopilot, redirects, quota cells and vendors are copied into the new project. Vendors that are no longer active, and redirect rules scoped to them, are left out and listed on the new project's page. Templates count how often and when they were last used.

Anyone who can edit projects can save and use templates. Only the person who made a template or an admin can rename or delete it. Names are unique per organisation. Deleting a template does not change projects made from it.

API: `GET /api/v1/project-templates`, `GET /api/v1/project-templates/:id`, `POST /api/v1/projects/:id/template`, `PATCH/DELETE /api/v1/project-templates/:id`, and `templateId` on `POST /api/v1/projects`.

## Drafts

The Create project form saves itself as a draft a moment after each change, once it has a name or a market. The bar at the top shows when it was last saved. Opening Create project again offers **Continue where you left off** with your drafts (up to 20 per person); **Discard draft** deletes one. Drafts are private to the person who wrote them. A draft is deleted when its project is created. Projects themselves still start in Draft status until they go to Test or Live.

API: `GET/POST /api/v1/project-drafts`, `GET/PUT/DELETE /api/v1/project-drafts/:id`, and `draftId` on `POST /api/v1/projects`.

## Settings history

Each project has a **History** tab. Every change to its settings is kept as a numbered version with who made it, when, and a before/after table of what changed:

- name, category, description, status, client contact, sales person, project manager;
- devices and each security check;
- human check style, gate and prescreener questions, respondent page design, autopilot, field dates;
- each market's LOI, IR, CPI, currency, completes, target group, survey links, session lifetime and status, and markets added.

A save that changes nothing makes no version. Projects created before this milestone get a starting version ("Settings before history was kept") the first time they change, so that change can be undone too.

**Restore** puts the settings of an earlier version back and saves the result as a new version, with an optional reason; the audit log records it as `project.restore-settings`. Status is not restored (going live or closing is not a settings change), nor are vendors, quotas and redirects, which keep their own records (redirects have their own versions). A person or client contact who has left since is not put back.

API: `GET /api/v1/projects/:id/history`, `POST /api/v1/projects/:id/history/:version/restore`.
