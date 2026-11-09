# Notifications: read and unread

The bell in the header (and Notifications on the phone app) lists alerts worked out live from the data:
fieldwork monitor alerts, failed callbacks, redirect fallbacks, markets close to target or without
traffic, expiring vendor documents, failed scheduled redirect changes, open requests and the person's
own task reminders, @mentions and handovers waiting for them ([TEAM_COLLABORATION.md](TEAM_COLLABORATION.md)). See `GET /insights` in `apps/api/src/dashboard/dashboard.controller.ts`.

## Read state is per person

- `NotificationRead` stores `(userId, key, title, readAt)`. `key` is the notification's id
  (for example `alert-<id>` or `task-<id>`), `title` its wording when it was read.
- An item is **read** when this person has a read mark for its id **with the same title**. When the
  wording changes ("3 vendor callbacks failed" becomes "5 vendor callbacks failed") it counts as new again.
- `GET /insights` returns `read` on every item, `alerts` and `unread` = alerts (warn/bad) this person
  has not read (the bell badge), and `alertsTotal` = all alerts. Older phone builds that show `alerts`
  automatically show the unread count.
- `POST /insights/read` with `{ items: [{ id, title }] }` (1–50) marks them read. Read marks older than
  60 days are removed for that person on each call.

## In the app

- Web: opening the bell marks the alerts it shows as read and the badge drops to the number still
  unread. While the menu is open, the items that were new keep a dot and a **New** label.
- Phone: opening the Notifications screen marks what it shows as read; unread items have a dot.
- Super Admin feature switch: `notifications` covers both endpoints.
