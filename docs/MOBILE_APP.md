# PROJEXA mobile app (Android and iOS)

`apps/mobile` is one Expo (React Native) app that builds for Android and iOS from the same code. It signs in to the same PROJEXA API as the web app and shows only the features Super Admin has switched on for the person, live.

## What is in the app

| Area | In the app | On the web (opens from the app) |
| --- | --- | --- |
| Sign-in | Email and password, two-step codes, Google, Microsoft and Zoho | |
| Command center | KPIs (active projects, completes, live quota, clients, revenue, margin, with trends), fieldwork health ring, live projects, needs-attention list, supplier performance chart, quick actions, recent activity | Widgets layout, world map, heatmap |
| Projects | Search and filter, project card with progress and links, project detail (stats, details, markets and vendors, quotas), share live and test entry links, go live / hold / close, pause and resume a vendor | Create project, redirects, gate and security, respondent pages, unique links, QA studio |
| Fieldwork monitor | Pace per market and vendor, alerts with acknowledge and resolve | Alert settings, autopilot rules, reallocation |
| AI copilot | Chat on live data, tables, charts and confirm/cancel action cards, voice (Gemini Live, or tap to talk) | Document upload |
| Tasks | Mine, all open, overdue, done; add, start, complete | |
| Requests | Inbox by status, thread, reply, internal note, close | Dispute decisions |
| Won bids | New / set up / dismissed with amounts and markets | Set up project from a bid |
| Reports | Client, vendor, project, country for 7/30/90 days, money in the reporting currency | PDF, CSV, saved views, schedules |
| Invoices, vendor payables | Lists, overdue, totals in the reporting currency | Create, send, record payments, accounting sync |
| Clients, vendors | Search, contacts (email, call), vendor grade and score | Edit, scorecards, capacity, sign-ups |
| Redirect health | Overall health, totals, per project, failing callback hosts | Charts, link checks |
| Notifications | Everything that needs attention and recent activity; push notifications for alerts, requests, task reminders and won bids | |
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

Screens that live in the app follow `mobile.features`; pages that open on the web (accounting, integrations, team, privacy, branding, settings, portal access, create project) follow `web`, the same switch the web app uses. A `block` in the answer (`ORG_SUSPENDED`, `ORG_PENDING`, `SUBSCRIPTION_INACTIVE`) shows the blocked screen. Server side: PR #42, docs/SUPER_ADMIN.md.

How fast a change shows: on the next API call (header), when More is opened, when the app comes back to the front, and at most every 30 seconds while open. A tab disappears; an open screen of a switched-off feature is replaced by a locked screen without loading its data. Role rules still apply on top (a viewer never gets "Create project", only admins get admin screens).

Servers without the switches endpoint (404) fall back to role rules, so the app works against today's API too.

## Single sign-on

The sign-in screen shows a button for each provider set up in Settings → Integrations (the same `GET /auth/sso/providers` the web uses). Nothing about Google, Microsoft or Zoho is stored in the app, and the providers need no extra redirect URI: the server's existing callback is used.

1. The app makes a PKCE pair (random verifier, SHA-256 challenge) and opens `GET /auth/sso/:provider/start?client=mobile&redirect=projexa://sso&challenge=…` in the phone's secure browser (ASWebAuthenticationSession on iOS, Custom Tabs on Android).
2. The person signs in at the provider as on the web. The organisation's rules apply unchanged (provider on, email domain, Microsoft tenant, SSO-only).
3. The server's callback does not set a browser session. It stores a one-time code (2 minutes, once) and shows a short page that opens `projexa://sso?code=…` (or `?error=…`).
4. The app sends `POST /auth/sso/mobile/exchange { code, verifier }`. The code only works with the verifier from step 1, so another app that catches the link cannot use it. The answer is a session, or `{ mfaRequired, mfaToken }`, and the app then asks for the authenticator code as with a password.

Only `projexa://` links are accepted, plus Expo Go's `exp://` outside production so the app can be tried while developing. Staff of an organisation set to "SSO only" can now use the app.

## Push notifications

Turn it on once in **Settings → Integrations → Mobile app → Push notifications** (server owner's admins): choose On, save, press Test. Pushes go through Expo's free push service; the optional Expo access token is only needed if "Enhanced security for push notifications" is on in the Expo account.

| Category | Who gets it | Opens |
| --- | --- | --- |
| Fieldwork alerts | The project's manager (admins for alerts without a project); warning and urgent only | The project |
| Requests | The person the request email goes to: the assignee or project manager for portal messages, the requester for staff replies; never internal notes | The request (staff), the portal (clients, vendors) |
| Task reminders | The assignee, once when the reminder comes due (again if the reminder is moved) | Tasks |
| Won bids | Admins and project managers | Won bids |

The app asks for permission after sign-in and registers the phone (`POST /push/devices`). Under **Account → Push notifications** people turn push off for that phone, pick categories (portal users only get requests) and send themselves a test. Signing out removes the phone. Phones that Expo reports as uninstalled are removed automatically. Task reminders are checked every minute (`PUSH_SCHEDULER_ENABLED=false` turns that off, e.g. on a second server).

API: `POST /api/v1/push/devices { token, platform, name?, categories? }`, `POST /api/v1/push/devices/remove { token }`, `POST /api/v1/push/test { token }` (any signed-in role, own phones only).

Expo needs the platform keys once (done in the Expo account, not in PROJEXA):

- **Android:** create a Firebase project, add an Android app with package `com.sampledge.projexa`, download the service account key (Project settings → Service accounts → Generate new private key) and upload it in expo.dev → your project → Credentials → Android → FCM V1 service account key.
- **iOS:** needs an Apple Developer account; `eas build --platform ios` offers to create the push key.

## Copilot voice

The microphone button next to the message box appears when the organisation has voice on (Settings → AI copilot) and the app runs on a phone.

- **Live voice (default):** the same Gemini Live session as the web (`POST /ai/voice/session`, short-lived token, the key never reaches the phone). The phone streams 16 kHz microphone audio over a WebSocket and plays the spoken answer. Tools run on the server (`/ai/voice/tool`) with the same confirmation cards, and each exchange is saved (`/ai/voice/turn`). The microphone pauses while the copilot speaks, so it does not hear itself on the loudspeaker; **Interrupt** stops the answer. Mute and End are on the voice bar.
- **Tap to talk (fallback):** used when Live is not available on the key or cannot connect. Tap, ask, tap again: the server writes the question down with Gemini (`POST /ai/voice/transcribe`), the normal chat answers, and the phone reads the answer aloud with its own voice.

Voice needs a development or store build (it uses the microphone module), not Expo Go.

## Android test build

What you need: a free Expo account (expo.dev) and an Android phone. No Android Studio.

1. `cd apps/mobile && npm install`
2. `npx eas-cli@latest login` (your Expo account), then `npx eas-cli@latest init` once. This creates the project in your account and writes its ID into `app.json` (`extra.eas.projectId`); push notifications need that ID. Commit the change.
3. In `eas.json` → `build.preview.env`, set `EXPO_PUBLIC_API_URL` to your API address (for example `https://api.projexa.yourcompany.com`) and `EXPO_PUBLIC_WEB_URL` to the web app. Both can also be typed on the sign-in screen later.
4. For push: upload the Firebase key as described under Push notifications (can be done after the first build too; then build again).
5. `npx eas-cli@latest build --platform android --profile preview`. The free plan queues the build in the cloud (often 10–30 minutes). When it finishes, the page and the terminal show a link and QR code for the `.apk`.
6. Open the link on the phone, download and install (allow "install unknown apps" for your browser once). Sign in.
7. Try: password and Google/Microsoft/Zoho sign-in, Account → Push notifications → Send a test, the copilot microphone.

A new build is only needed when native parts change (new modules, icons, app.json). The phone must reach the API address: a server on your laptop needs the laptop's network IP, and HTTPS for sign-in with Google, Microsoft and Zoho.

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

- Document upload to the copilot (use the web).
- Push for every event: only the four categories above. The bell and the 30-second check still cover everything while the app is open.
- iOS install for testing needs an Apple Developer account (TestFlight); the Android steps above need none.
