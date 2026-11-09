# Team collaboration: comments, @mentions, handovers and activity

The **Team** tab on every project (between *Files & requests* and *History*) is where staff work
together on a project. Everything on it is staff only: client and vendor portal logins get `403`
from these endpoints and never see the tab.

Code: `apps/api/src/collaboration/collaboration.ts`, `apps/web/components/project/team-tab.tsx`.
Tables: `ProjectComment`, `ProjectHandover` (migration `20261110090000_team_comments_handovers`).

## Comments and @mentions

- Any staff member (admin, project manager, sales, viewer) can read and post comments.
- Type `@` in the comment box to pick a colleague. The picked person is mentioned while their
  `@Full Name` is still in the text. A typed `@Full Name` also counts when exactly one active staff
  member has that name. Portal users can never be mentioned.
- Each person mentioned (not the writer) gets:
  - a **bell** item `mention-<commentId>` for 14 days ("Arjun Rao mentioned you on PRX10001"), which
    counts in the unread badge until they open the bell (see [NOTIFICATIONS.md](NOTIFICATIONS.md));
  - an **email** through the organisation's Zoho Mail / SMTP settings (Settings → Integrations). When
    email is not set up the comment is still saved;
  - a **phone push** in the new `team` category ("Mentions and handovers"), when they use the app.
- The link in the bell and email opens `/projects/<id>?tab=team#comment-<id>`, scrolls to the comment
  and highlights it.
- Only the writer can edit a comment (shown as *edited*); editing notifies only people newly mentioned.
  The writer or an admin can delete it.

| Method | Path | Who |
| --- | --- | --- |
| GET | `/projects/:id/mentionable` | staff: active staff who can be mentioned |
| GET | `/projects/:id/comments` | staff |
| POST | `/projects/:id/comments` `{ body, mentionIds? }` | staff |
| PATCH | `/projects/:id/comments/:commentId` `{ body, mentionIds? }` | the writer |
| DELETE | `/projects/:id/comments/:commentId` | the writer or an admin |

## Handover checklist

When a project moves to another project manager, the current one starts a handover:

1. Choose who takes over (an active admin or project manager), add a note, keep or untick the
   standard items and add up to 10 of your own.
2. Both people (or an admin) tick items. Each tick records who and when.
3. The receiver presses **Accept handover** once every item is ticked. If *Make them the project
   manager* was on (the default), they become the project manager through the normal project update,
   so the change also shows on the History tab.
4. The sender or an admin can cancel an open handover. A project has at most one open handover.

Standard items: survey links checked in QA studio; redirects and callbacks verified; vendors,
allocations and CPIs explained; quotas, targets and field end date reviewed; client contact,
expectations and deadlines shared; open requests, tasks and disputes passed on; reconciliation and
invoicing status explained.

The receiver gets a bell item `handover-<id>` while the handover is open, plus an email and a push.
The sender gets an email and push when it is accepted, the receiver when it is cancelled.

| Method | Path | Who |
| --- | --- | --- |
| GET | `/projects/:id/handovers` | staff (latest 20 and the standard items) |
| POST | `/projects/:id/handovers` `{ toUserId, note?, skip?, extraItems?, makeManager? }` | admin, project manager |
| PATCH | `/projects/:id/handovers/:handoverId/items/:key` `{ done }` | sender, receiver, admin |
| POST | `/projects/:id/handovers/:handoverId/accept` | the receiver |
| POST | `/projects/:id/handovers/:handoverId/cancel` | sender, admin |

## Activity feed

`GET /projects/:id/activity?kind=all|comments|handovers|changes|fieldwork|requests&limit=40&before=<iso>`
lists the project's audit events newest first, with a readable label ("changed project settings",
"Autopilot paused a vendor link") and a one-line summary where there is one. `next` is the `before`
value for the next page. It reads the existing audit log (`entityType = 'Project'`, or a `projectId` in
the detail), so everything already audited on a project shows without extra work.

Super Admin: the endpoints sit under the `projects` feature switch.
