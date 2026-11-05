# PROJEXA mobile app (Android and iOS)

`apps/mobile` is one Expo (React Native) app that builds for Android and iOS from the same code. It signs in to the same PROJEXA API as the web app and shows only the features Super Admin has switched on for the person, live.

## What is in the app

| Area | In the app | On the web (opens from the app) |
| --- | --- | --- |
| Command center | KPIs (active projects, completes, live quota, clients, revenue, margin, with trends), fieldwork health ring, live projects, needs-attention list, supplier performance chart, quick actions, recent activity | Widgets layout, world map, heatmap |
| Projects | Search and filter, project card with progress and links, project detail (stats, details, markets and vendors, quotas), share live and test entry links, go live / hold / close, pause and resume a vendor | Create project, redirects, gate and security, respondent pages, unique links, QA studio |
| Fieldwork monitor | Pace per market and vendor, alerts with acknowledge and resolve | Alert settings, autopilot rules, reallocation |
| AI copilot | Chat on live data, tables, charts and confirm/cancel action cards | Voice, document upload |
| Tasks | Mine, all open, overdue, done; add, start, complete | |
| Requests | Inbox by status, thread, reply, internal note, close | Dispute decisions |
| Won bids | New / set up / dismissed with amounts and markets | Set up project from a bid |
| Reports | Client, vendor, project, country for 7/30/90 days, money in the reporting currency | PDF, CSV, saved views, schedules |
| Invoices, vendor payables | Lists, overdue, totals in the reporting currency | Create, send, record payments, accounting sync |
| Clients, vendors | Search, contacts (email, call), vendor grade and score | Edit, scorecards, capacity, sign-ups |
| Redirect health | Overall health, totals, per project, failing callback hosts | Charts, link checks |
| Notifications | Everything that needs attention and recent activity | |
| Client portal | Projects, progress, completes waiting for approval | Approvals, invoices, files |
| Vendor portal | Live links (share), completes, conversion, payouts waiting | Statements, disputes, files |
| Admin (integrations, team, privacy, branding, settings, accounting, portal access) | Listed under More for admins | Opens the web page |

Two looks from the design mockups: **Neon** (dark) and **Aurora** (light). Automatic follows the phone; people can pick one under Account.

## Feature switches (contract with Super Admin)

The app and the web read the same switches. The server side is built in the Super Admin work.

1. `GET /api/v1/auth/me/features` (any signed-in role, also before two-step setup) answers:

   ```json
   { "version": "string that changes whenever this person's switches change",
     "plan": "Growth",
     "web":    { "projects": true, "reports": false },
     "mobile": { "enabled": true, "features": { "projects": true } } }
   ```

   Effective = organisation subscription AND per-user assignment AND role. A missing key means off; unknown keys are ignored.
2. Every authenticated answer carries `X-Features-Version`. When it differs from the version the app has, the app re-reads the switches at once.
3. A switched-off feature's API answers `403 { "code": "FEATURE_DISABLED", "feature": "<key>" }`; a suspended organisation `ORG_SUSPENDED`; a lapsed subscription `SUBSCRIPTION_INACTIVE`; mobile switched off for the person `MOBILE_DISABLED`. The app sends `X-Client: mobile` on every call so the server applies the mobile switches.
4. Keys: `dashboard, copilot, projects, projects.create, tasks, requests, won_bids, notifications, monitor, redirect_health, reports, invoices, payables, accounting, clients, vendors, portal_access, integrations, team, privacy, branding, settings, portal.client, portal.vendor` (`apps/mobile/src/lib/features.ts`).

How fast a change shows: on the next API call (header), when More is opened, when the app comes back to the front, and at most every 30 seconds while open. A tab disappears; an open screen of a switched-off feature is replaced by a locked screen without loading its data. Role rules still apply on top (a viewer never gets "Create project", only admins get admin screens).

Servers without the switches endpoint (404) fall back to role rules, so the app works against today's API too.

## Run it

```bash
cd apps/mobile
npm install
EXPO_PUBLIC_API_URL=http://<your-computer-ip>:4000 npx expo start   # scan the QR code with Expo Go, or press a / i
npm run typecheck && npm test
```

The app uses npm and its own lockfile (Expo tooling); it is left out of the pnpm workspace. The server address can also be typed on the sign-in screen (Server and organisation), with an optional web address for "Open on web".

## Build for the stores

Builds run in the cloud with EAS; no Mac or Android Studio needed.

```bash
cd apps/mobile
npx eas-cli@latest login
# set EXPO_PUBLIC_API_URL and EXPO_PUBLIC_WEB_URL in eas.json for your server
npx eas-cli@latest build --platform android --profile preview     # installable APK for testing
npx eas-cli@latest build --platform all --profile production      # Play Store .aab and App Store .ipa
npx eas-cli@latest submit --platform all
```

You need a Google Play developer account and an Apple Developer account. Bundle id / package: `com.sampledge.projexa` (change in `app.json` before the first store upload if you want another).

## Not in this version

- Sign-in with Google, Microsoft or Zoho (password and two-step codes work). Staff of an organisation set to "SSO only" cannot sign in to the app yet.
- Push notifications (the bell and the 30-second check cover alerts while the app is open).
- Copilot voice and document upload.
