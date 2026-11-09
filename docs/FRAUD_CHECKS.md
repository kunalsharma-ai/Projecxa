# Stronger fraud checks

Added on top of the respondent checks in [RESPONDENT_SECURITY.md](RESPONDENT_SECURITY.md). Every part is free, every part is switched on per project in **Gate & security**, and the only setup is in **Settings → Integrations → IP and proxy reputation**. Test links run all of it and log the result, but never block.

| Toggle (Gate & security) | Group | Runs at | Stops as |
|---|---|---|---|
| IP and proxy reputation | Location and browser | entry | `SECURITY_REJECT` / `PROXY_VPN`, `DATACENTER_IP`, `IP_ABUSE`, `IP_BLOCKED` |
| Automated browsers | Bots | gate page | `SECURITY_REJECT` / `AUTOMATED_BROWSER` |
| Across projects | Duplicates | gate page | `DUPLICATE` / `SEEN_IN_OTHER_PROJECT` |
| (always, with the existing duplicate checks) | Duplicates | entry and gate page | `DUPLICATE` / `CROSS_VENDOR` |
| Risk score threshold (Fraud rules) | – | gate page, or entry when there is no gate page | `SECURITY_REJECT` / `HIGH_RISK` |

## IP and proxy reputation

Checked at entry, before a session gets the survey link. The first match decides, in this order:

1. **Always allow** (the organisation's list): passes. Use it for the office and QA VPNs.
2. **Always block** (the organisation's list): `IP_BLOCKED`.
3. **Free public lists**, refreshed every 12 hours into the database (`IpReputationRange`: each range is stored with its first and last address as 32 hex digits, IPv4 as IPv4-mapped IPv6, and matched with an index on both):
   - FireHOL Level 1 (attacks and abuse) → `IP_ABUSE`
   - X4BNet VPN ranges → `PROXY_VPN`
   - X4BNet data centre and hosting ranges → `DATACENTER_IP`
   Private and reserved ranges in a list (FireHOL lists bogons such as 10.0.0.0/8) are dropped, so local and office traffic is never blocked by a list. A download that fails or looks wrong (under 20 ranges) keeps the previous list.
4. **proxycheck.io** with the organisation's own free key (1,000 lookups a day): `proxy: yes` → `PROXY_VPN`. Each address is looked up at most once a week (`IpLookupCache`, keyed by a hash of the address). The lookup waits 2.5 seconds at most.

If no source can answer (lists not loaded yet, proxycheck.io down or over its daily limit), the respondent is let through and the check notes why. A data source outage never stops fieldwork.

Settings → Integrations → **IP and proxy reputation** (each organisation's admin): Free public lists On/Off (default On, also when nothing is saved), proxycheck.io key (optional, stored encrypted), Always allow, Always block (IPv4/IPv6 addresses or ranges, comma separated; checked on save). **Test** says which lists are loaded and whether proxycheck.io accepts the key. Admins can load the lists at once with `POST /security/ip-lists/sync`; the server also loads them 15 seconds after it starts. `IP_REPUTATION_SYNC=false` turns the download off (air-gapped servers); tests never download.

## Automated browsers

The gate page reports a few browser facts (only when the toggle is on): the `navigator.webdriver` flag, automation globals left by Selenium, PhantomJS, Nightmare and Playwright, plugin and language counts, touch points, the platform, the `window.chrome` object, the window size and the graphics renderer.

- **Hard signs** fail on their own: the webdriver flag, automation globals, a headless or scripted user agent (HeadlessChrome, PhantomJS, Electron, curl, python-requests…).
- **Soft signs** add 15 risk points each, and fail when two or more come together: software graphics (SwiftShader, llvmpipe), a phone without touch, a user agent that does not match the platform (Windows UA on Linux), Chrome without `window.chrome`, no languages, no window, desktop Chrome without plugins.

## Device fingerprint and device hash

Browser fingerprinting already matched the full fingerprint (user agent, languages, screen, hardware, time zone, canvas, WebGL). The gate page now also sends a **device hash** without the browser version and languages, and with the screen sides sorted, so a browser update, a new language setting or turning the phone sideways does not hide a repeat device. Either one matching means `SAME_FINGERPRINT`. Both are stored as organisation-scoped hashes; erasure clears them.

## Same person across vendors and projects

- **Across vendors (same project):** the existing same IP + browser, fingerprint/device and browser cookie checks already looked at every vendor of the project. When the earlier session came through another vendor, the reason is now `CROSS_VENDOR`, so the vendor report shows panels sending the same people.
- **Across projects:** with **Across projects** on, the device hash, fingerprint and browser cookie are looked up in the organisation's other projects. **Fraud rules** set which projects count (all, this client's, or picked ones), how many days back (1–365, default 90) and who counts (anyone who entered, or only completes). An IP address alone is not used across projects: mobile carriers and offices share addresses over months.
- **Same person elsewhere** (side panel in Gate & security, `GET /projects/:id/fraud/linked`): groups this project's respondents with sessions elsewhere that share any identifier, showing project, vendor, respondent ID, outcome, date and risk. Live traffic of the organisation only, at most 50 groups.

## Risk score

Every respondent gets a score from 0 to 100 (`RespondentSession.riskScore`, with the reasons in `riskSignals`): the weights of the fraud checks that failed plus soft signals (`src/survey/fraud.ts`, `RISK_WEIGHTS`; for example automated browser 70, TOR 60, data centre 45, cross-vendor 50, other project 35, time zone 25). Screen-outs, quotas and consent are not fraud and add nothing. Entry and gate points add up.

**Reject at risk score** (Fraud rules) rejects as `HIGH_RISK` once the score reaches it; empty only records the score. The checks summary shows how many respondents are low (0–34), medium (35–69) and high (70+).

## Data

| Where | What |
|---|---|
| `Project.fraudRules` | `{ crossProject: { scope, projectIds, days, outcomes }, riskThreshold }`, in project history and copies |
| `RespondentSession.deviceHash`, `riskScore`, `riskSignals` | per respondent |
| `IpReputationRange`, `IpReputationSource` | the free lists, server wide |
| `IpLookupCache` | proxycheck.io answers, 7 days |
| `IntegrationSetting` kind `ip_reputation` | `IP_LISTS`, `PROXYCHECK_API_KEY` (encrypted), `IP_ALLOWLIST`, `IP_BLOCKLIST` |
