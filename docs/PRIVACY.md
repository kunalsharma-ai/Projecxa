# Privacy: retention, consent and erasure

Milestone 31. Screen: **Settings → Privacy** (`/settings/privacy`, admins). API: `/api/v1/privacy`.

## Data retention

Two settings per organisation, both optional (empty means keep):

| Setting | What happens |
| --- | --- |
| Anonymise respondents after N days | Finished respondent sessions older than N days (by start time) lose everything that identifies the person. |
| Delete the event log after N days | Respondent events (the Clicks report) and redirect executions older than N days are deleted. |

The minimum is 30 days and the maximum 3650.

**What anonymising removes:** the panel's respondent ID (it becomes `erased:<session id>`, so the ID can be used again on that link), the hashed IP, user agent, fingerprint and browser-ID hashes, the geolocation country, gate and prescreen answers, the detail of every event, the destination URL of each redirect, and the URL and body of finished terminal callbacks.

**What it keeps:** status, approval, money (revenue, payout, currency), device type, market, vendor, timestamps, quota cells and the consent record. Reports, invoices, bills, quotas and vendor scores therefore do not change. The Clicks report loses rows once the event log is deleted.

**Skipped:**
- Sessions still in the survey. A session that never came back is anonymised once it is past its expiry.
- Completes still waiting for client approval (`approval = PENDING`). They are anonymised on the first run after the approval is decided.
- Callbacks still being retried keep their URL until they finish.

**When it runs:** a job checks every hour and runs each organisation once a day. **Run now** applies the settings straight away, after showing what is due. Each run that changes something is written to the audit log (`privacy.retention_run`).

Set `PRIVACY_SCHEDULER_ENABLED=false` to turn the hourly job off, for example on extra API instances.

## Consent notices

Admins write a notice for a market (`DE`, `GB`, …) or one for every other market (`*`). A market's own notice wins over `*`. A market's notice that is switched off means that market shows no notice, even if `*` exists.

When a notice applies, the respondent goes through the entry page (`/g/:token`) even if the project has no other browser checks. The notice is the first step:
- It shows the title and text, and a link to the full privacy notice (https only, opened in a new tab).
- The respondent must tick **I have read this and I agree** to continue.
- **I do not agree** ends the session as `PARTIAL` with reason `CONSENT_DECLINED`, and sends the respondent to the vendor's partial redirect.
- A submit without an answer counts as `SECURITY_REJECT` / `GATE_INCOMPLETE`.

Test links show the notice but do not end the session.

Agreeing stores `consentAt` and `consentVersion` on the session. Changing a notice's title, text or link starts a new version. Switching it on or off does not.

The page's buttons and instructions are in English. Write the notice itself in the market's language.

## Access and erasure requests

Search by the respondent ID the panel uses (an exact match). The search shows every session with that ID across projects: project, market, vendor, status, approval, consent and start time.

**Erase** anonymises the chosen sessions at once, the same way retention does, whatever the retention settings. It is audit-logged (`privacy.erase`) with the reason.

Erased sessions no longer match the search, because their ID has changed.

## API

All `PUT`, `POST` and `DELETE` calls, and the respondent search, are admin only. Anyone signed in can read `GET /privacy`.

| Method | Path | Body / query |
| --- | --- | --- |
| GET | `/privacy` | Returns the retention settings, what is due now, the last run, totals and the consent notices. |
| PUT | `/privacy/retention` | `{ respondentDays, eventDays }` (number or null) |
| POST | `/privacy/retention/run` | Returns `{ sessions, events, ranAt }`. |
| PUT | `/privacy/consent/:countryCode` | `{ enabled, title, body, privacyUrl }`. Use `*` (encoded as `%2A`) for every other market. |
| DELETE | `/privacy/consent/:countryCode` | |
| GET | `/privacy/respondents?uid=…&vendorId=…` | |
| POST | `/privacy/respondents/erase` | `{ sessionIds: [...], reason? }` |

## Data model

- `Organization.retention` (JSON `{respondentDays, eventDays}`) and `retentionRunAt`.
- `ConsentPolicy`: organisation, `countryCode`, `enabled`, `title`, `body`, `privacyUrl`, `version`, updated by. Each country code is unique per organisation.
- `RespondentSession.consentAt`, `consentVersion` and `anonymizedAt`.

Migration: `20261102170000_privacy_retention_consent`.

## Not included

- Notices in several languages for one market.
- Consent receipts emailed to respondents. Respondents are anonymous to SampTrek.
- Automatic erasure requests from panels through the API.
