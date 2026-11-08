# Respondent security, gate survey and prescreener

Every respondent who opens a vendor entry link goes through these steps, in this order. Each step only runs when the project turned it on (project → **Gate & security**).

| Step | Where | Checks | Fails as |
|---|---|---|---|
| 1. Entry link | server, before a session exists | URL protection: `sig = hex(HMAC-SHA256(vendor signing secret, UID))` | refused (no session, so the real respondent's ID is not used up); counted in the project's security summary |
| 2. Entry | server | device type (from the user agent), TOR exit node, IP and proxy reputation, geolocation, same IP + browser | `SECURITY_REJECT` (`DEVICE_NOT_ALLOWED`, `MOBILE_OS_NOT_ALLOWED`, `TOR_EXIT`, `PROXY_VPN`, `DATACENTER_IP`, `IP_ABUSE`, `IP_BLOCKED`, `GEO_MISMATCH`) or `DUPLICATE` (`SAME_DEVICE`, `CROSS_VENDOR`) |
| 3. Human check | gate page | chosen captcha style, 3 tries, new challenge each try | `SECURITY_REJECT` / `HUMAN_CHECK_FAILED` |
| 4. Gate survey | gate page | executive's gate questions | `TERMINATE` / `GATE_SCREENOUT`; invalid answers `SECURITY_REJECT` / `GATE_INCOMPLETE` |
| 5. Prescreener | gate page | executive's prescreener questions | `TERMINATE` / `PRESCREEN` |
| 6. Browser checks | gate page submit | background proof-of-work (captcha), cookies, browser language, time zone, automated browsers, fingerprint / device hash and browser cookie duplicates, the same person in other projects, the risk score | `SECURITY_REJECT` (`CAPTCHA_FAILED`, `COOKIES_BLOCKED`, `LANGUAGE_MISMATCH`, `TIMEZONE_MISMATCH`, `AUTOMATED_BROWSER`, `HIGH_RISK`) or `DUPLICATE` (`SAME_FINGERPRINT`, `SAME_BROWSER`, `CROSS_VENDOR`, `SEEN_IN_OTHER_PROJECT`) |
| 7. Client survey | | the survey link (with the opaque session token) is only released here | |

The stronger fraud checks (IP and proxy reputation, automated browsers, across projects and vendors, risk score) are described in [FRAUD_CHECKS.md](FRAUD_CHECKS.md).

When several things fail at once, bot and fraud reasons win over screen-outs, so a duplicate is never hidden as a terminate. An outcome reported for a session that never passed the gate is recorded as `SECURITY_REJECT` / `GATE_SKIPPED`.

**Test links** run every check and log the results (`SECURITY_CHECK` events with `enforced: false`) but never block, so QA can click through.

## Questions

Gate survey and prescreener questions share one model (`apps/api/src/survey/questions.ts`). The browser validates for a good experience; the server validates again and applies the rules.

| Type | Validation | Screening |
|---|---|---|
| Single choice, dropdown | one listed answer | answer marked *Screen out*; or, if any answers are marked *Must pick one of these*, anything else |
| Multiple choice | fewest / most choices, "only answer" options (e.g. None of these) | any *Screen out* answer; *Must pick one of these* as above |
| Number | lowest / highest allowed, whole numbers only | outside the qualifying range (e.g. age 18 and over) |
| Text | shortest / longest, format: letters, digits, letters and digits, email, postal code, phone | none |
| Grid | every row answered with a listed column | a *Screen out* column on any row |

Every question can be required or optional. Fixed formats are used instead of free regular expressions so a question can never slow the server down. The library (`GET /question-templates?currency=`) has age, gender, postal code, household income (bands per currency), employment and education.

Answers are stored on the session as `{ gate: {...}, prescreen: {...} }` with value and label, and shown in the project's **Answers** tab and the **Answers** report (counts per answer, filters, CSV export).

## Captcha styles (free only)

| Style | What the respondent sees | Notes |
|---|---|---|
| Math | "What is seven plus four?" | built in |
| Logic | "Which of these is a fruit?" (four words) | built in |
| Picture text | five distorted characters, drawn as strokes (not text) | built in |
| Invisible | nothing | background proof-of-work only |
| Cloudflare Turnstile | usually one click or nothing | free, unlimited checks, up to 20 widgets per Cloudflare account; admin adds keys in Settings |
| hCaptcha | checkbox, image puzzles when unsure | free Basic plan; admin adds keys in Settings |

Google reCAPTCHA is not offered: its free tier is 10,000 assessments a month, after which it fails or needs billing. If a provider is unreachable, the respondent is let through and the check is logged as unverified, so a provider outage never stops fieldwork. A provider style without keys falls back to the math question.

## Server setup

- **Geolocation** needs the respondent's country from the CDN or load balancer: set `GEO_COUNTRY_HEADER` (for example `cf-ipcountry`). Unset, the check is shown as not active and lets entries through.
- **TOR detection** downloads the TOR Project exit list on start and every 6 hours (`TOR_EXIT_LIST_URL`, `TOR_EXIT_LIST_SYNC=false` to turn off). Until it loads, entries are let through.
- The gate page sends a strict Content Security Policy; only the chosen captcha provider's domains are added.

## Mobile: Android and iOS

Under **Mobile** (Create project → Devices, and the project's Gate & security tab) you can tick **Android**, **iOS** or both. Both are on by default, and older projects count as both on.

- The phone system is read from the user agent at entry: `Android` → Android, `iPhone` / `iPod` / `iPad` → iOS.
- A phone whose system is not allowed is rejected at entry as `SECURITY_REJECT` with `MOBILE_OS_NOT_ALLOWED`.
- A phone with another system (for example KaiOS) gets in only when both Android and iOS are ticked.
- Tablets follow the Tablet switch only; Android / iOS applies to phones.
- With Mobile on, at least one of Android / iOS must be ticked (the API returns 400 otherwise).
