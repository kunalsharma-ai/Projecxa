# Super Admin: organisations, subscriptions, feature switches, activity and automation

The **Super Admin** runs the whole SampTrek server. Above every organisation's own admins, they:

- register organisations (or approve the ones that registered themselves), pause and reactivate them;
- give each organisation a **plan**: a package of features for the web app and for the Android/iOS app, with user and project limits;
- switch **any single feature** on or off for one organisation, or for one person, separately on the web and in the mobile app;
- see **all activity** of every organisation's admins and their users;
- control **every organisation's integrations** (allow, block, remove saved settings);
- automate all of it with plain **When / Only if / Then** rules and ready-made recipes;
- back up and restore the whole database (**Backups**, [BACKUPS.md](BACKUPS.md)) and run the public
  **Status page** with uptime and incidents ([STATUS_PAGE.md](STATUS_PAGE.md)).

Organisations pay for their plan online (Razorpay or Stripe) or offline (bank transfer, UPI, cheque, cash), and a payment renews the subscription by itself: see [SUBSCRIPTION_PAYMENTS.md](SUBSCRIPTION_PAYMENTS.md). Renewals can also be set on the subscription by hand or by automation.

Open it from **Super Admin** in the menu (only Super Admins see it).

## Who is the Super Admin

- `User.superAdmin = true`, honoured **only** for admins of the organisation that runs the server (`Organization.platformOwner`). The flag means nothing anywhere else.
- The migration makes the oldest active admin of the platform owner organisation the first Super Admin. `pnpm create-admin` does the same on a fresh server (`--super-admin` adds another).
- A Super Admin can make other admins of the platform owner organisation Super Admins from **Super Admin → Organisations → (your organisation) → People**. Nobody can remove their own Super Admin access.
- The platform owner organisation always has every feature and can never be paused.

## Plans and subscriptions

- **Plans** (`Plan`): name, code, description, price label, web features, mobile features, mobile app on/off, user limit, project limit, offered or not. Three starter plans are made the first time plans are opened: Starter, Professional, Enterprise. Edit them freely.
- **Subscription** (`Subscription`, one per organisation): plan, status, start, end/renewal date, trial end, optional user/project limits that override the plan, mobile app on/off for the organisation, private notes.
- Status: `TRIAL` (works until the trial end), `ACTIVE` (works until the end date; none = no end), `PAST_DUE` (still works: late renewal), `EXPIRED` and `CANCELLED` (no access).
- **An organisation without a subscription keeps every feature with no limits**, so servers from before this change keep working as they are.

### What a person may use

```
web    = plan.features        ± organisation switches (web)    − person's featuresOff
mobile = plan.mobileFeatures  ± organisation switches (mobile) − person's featuresOff − person's mobileFeaturesOff
         and only if plan.mobileEnabled, subscription.mobileEnabled and the person's mobileAccess are all on
```

…and limited by role (e.g. Team is admins only, the client portal is client users only). Paused organisations, organisations waiting for approval and ended subscriptions get nothing.

## Who gets what: the layers

Every feature passes four layers (details in docs/FEATURE_ACCESS.md):

1. **Plan** — what the organisation bought (Super Admin → Plans).
2. **Organisation switches** — the Super Admin gives extra features or takes some away (Super Admin → Organisations → Features).
3. **Admin** — the organisation's Admin chooses who in the team gets each feature they have: everyone, admins only, chosen people or no one (Settings → Features & access). They cannot hand out anything layers 1–2 do not give.
4. **Person** — the Super Admin can still take features away from one person (Organisations → People).

Usage limits per plan and per organisation (projects, clicks, completes, clients, vendors, portal logins…): docs/PLAN_LIMITS.md.
Observing an organisation read-only and its traffic: docs/SUPER_ADMIN_OBSERVE.md.

## How it is enforced (web and mobile at once)

Every authenticated API request goes through `auth.guard.ts`:

1. The route is matched to a feature in `src/super-admin/features.ts` (one table for the whole API). A test fails when a new route is not in the table.
2. Requests with `X-Client: mobile` are checked against the mobile set; others against the web set.
3. Answers:
   - `403 { code: "FEATURE_DISABLED", feature }` for a switched-off feature;
   - `403 { code: "ORG_SUSPENDED" | "ORG_PENDING" | "SUBSCRIPTION_INACTIVE" }` when the organisation has no access (sign-in, `/auth/me`, `/auth/me/features` and two-step setup still answer, so apps can explain);
   - `403 { code: "MOBILE_DISABLED" }` for mobile calls when the person or organisation has no app access;
   - `403 { code: "PLAN_LIMIT", limit: "users" | "projects" }` when adding a user or project over the plan's limit.
4. Every response carries `X-Features-Version` (exposed to browsers by CORS). It changes whenever what the person may use changes.

Pausing an organisation signs everyone there out at once, and nobody there can sign in until it is reactivated. Respondent survey links keep working while an organisation is paused, so live fieldwork is never cut off mid-interview by an admin action.

The public API (`/api/v1/public`, API keys) needs the `developers` feature, and stops while the organisation has no access.

### The features contract (web and mobile apps)

`GET /api/v1/auth/me/features` (any signed-in role, also before two-step setup):

```json
{
  "version": "3f9c2a…",
  "plan": "Professional",
  "block": null,
  "superAdmin": false,
  "web":    { "dashboard": true, "projects": true, "monitor": false, "...": true },
  "mobile": { "enabled": true, "features": { "dashboard": true, "projects": true, "...": false } }
}
```

The web app reloads it when `X-Features-Version` changes, on any `FEATURE_DISABLED` answer, every 30 seconds and when the tab comes back into view. It hides switched-off items from the menu and Ctrl K, and shows "not part of your access" instead of the page. The mobile app (docs/MOBILE_APP.md) follows the same contract.

Feature keys: `dashboard, copilot, tasks, chat, collaboration, languages, requests, notifications, projects, client_dashboards, vendor_routing, fraud_checks, forecasting, projects.create, won_bids, monitor, redirect_health, reports, invoices, payables, accounting, clients, vendors, portal_access, integrations, developers, team, privacy, branding, settings, portal.client, portal.vendor` and one per integration: `integration.smtp, integration.sso_google, integration.sso_microsoft, integration.sso_zoho, integration.gemini, integration.zoho_books, integration.xero, integration.quickbooks, integration.tally, integration.bidzo`. Unknown keys are ignored by clients; a missing key means off.

## Integrations control

**Super Admin → Integrations** shows, for every organisation and integration, whether it is allowed, set up, and whether its last test worked. On an organisation's **Integrations** tab you allow or block each one (an `integration.<kind>` feature) and can delete its saved settings. A blocked integration stops working at once (the app treats it as not set up) and its card in Settings → Integrations says "Not part of your plan". Secrets are never shown to the Super Admin.

## Activity

**Super Admin → Activity** lists the audit log of every organisation, newest first, filterable by organisation and kind (sign-ins, team changes, projects, integrations, Super Admin changes…). Sign-ins are now recorded (`auth.sign_in`), and each user's last activity (`User.lastSeenAt`, written at most every 5 minutes) shows on Organisations and People. Every Super Admin change is recorded in the affected organisation's log with `bySuperAdmin`.

## Registration

- **Super Admin → Registrations**: open or close the public page `/register`, pick the default plan and trial length.
- The form has a free maths check, a honeypot and a limit of 5 registrations per network per hour. It creates the organisation as **waiting for approval** with an inactive admin; nobody can sign in yet.
- **Approve** starts it on the chosen plan (trial if trial days > 0) and emails the admin a link to choose a password (from the platform owner's email settings; if those are not set, the link is shown to copy). **Turn down** deletes the registration.
- The Super Admin can also add an organisation directly from **Organisations → Add organisation**.

## Automation

**Super Admin → Automation**. A rule is:

- **When** (trigger): an organisation registers · an organisation starts · a trial is about to end (N days before) · a subscription is about to end (N days before) · a subscription or trial has ended (N days after) · nobody signs in for N days · more users than the plan allows · an integration test fails.
- **Only if** (optional): the plan is one of …; the subscription status is one of ….
- **Then** (one or more, in order): email the organisation's admins · email the Super Admins · add a task for the Super Admins · approve the registration · set the subscription status · move to another plan · extend the subscription or trial by N days · pause / reactivate the organisation · turn a feature on, off or back to the plan.

Emails and tasks can use `{{org}}`, `{{plan}}`, `{{date}}`, `{{days}}` and `{{detail}}`.

Event rules run at once. Time rules are checked every hour (`AUTOMATION_SCHEDULER_ENABLED=false` turns the scheduler off) or with **Run time rules now**. Each rule acts **once per organisation and occasion** (e.g. once per end date), even with several servers; every run and its result is in the **Run log**. **Who would it act on now?** previews a rule without acting.

Ready-made recipes (one click, then edit): tell me about new registrations · approve registrations on a trial · welcome new organisations · trial ending reminder · renewal reminder · grace period when a subscription ends (past due for 7 days) · expire after the grace period · inactive organisations · over the user limit · integration problems.

Emails are sent with the platform owner organisation's email settings (Settings → Integrations → Email).

## API (all need the Super Admin)

| Method | Path | |
| --- | --- | --- |
| GET | `/super-admin/overview` | Counts, ending soon, plans, latest runs and activity |
| GET | `/super-admin/catalog` | Features, groups, automation triggers/actions/recipes |
| GET/PUT | `/super-admin/settings` | `{ registrationOpen, defaultPlanCode, trialDays }` |
| GET/POST | `/super-admin/plans` · PATCH/DELETE `/super-admin/plans/:id` | Plans (cannot delete one in use) |
| GET/POST | `/super-admin/organizations` | List (`?q=&status=`) / create with first admin |
| GET/PATCH | `/super-admin/organizations/:id` | Detail with feature matrix / rename, pause, reactivate |
| POST | `/super-admin/organizations/:id/approve` · `/reject` | Registrations |
| PUT/DELETE | `/super-admin/organizations/:id/subscription` | Set / remove the subscription |
| PUT | `/super-admin/organizations/:id/features` | `{ changes: [{ feature, channel: web\|mobile, state: plan\|on\|off }] }` |
| GET | `/super-admin/organizations/:id/users` | People with their access |
| DELETE | `/super-admin/organizations/:id/integrations/:kind` | Remove saved integration settings |
| PATCH | `/super-admin/users/:id` | `{ active, mobileAccess, featuresOff, mobileFeaturesOff, superAdmin }` |
| POST | `/super-admin/users/:id/sign-out` | Sign out everywhere |
| GET | `/super-admin/activity` | `?organizationId=&userId=&action=&before=&limit=` |
| GET | `/super-admin/integrations` | Matrix of every organisation × integration |
| GET/POST | `/super-admin/automations` · PATCH/DELETE `/:id` · POST `/:id/run` | Rules |
| POST | `/super-admin/automations/preview` · `/run` · `/recipes/:id` | Preview, run all time rules, add a recipe |
| GET | `/super-admin/automations/runs` | Run log (`?ruleId=`) |
| GET/POST | `/public/register` | Public registration form |

## Not included

- Org admins cannot restrict features for their own users yet; only the Super Admin can.
- The AI copilot's read-only tools can still summarise data of a feature that is switched off for the person (the copilot itself is a feature that can be switched off).
