# Dynamic redirect destinations (milestone 25)

Three additions to the redirect engine (`apps/api/src/redirects`): destinations asked live from an API, scheduled activation of a redirect version, and a comparison of any two versions.

## API destinations

In **hybrid** mode a rule can be `type: "API"`. Its `url` is the endpoint to ask; it also needs a `fallbackUrl` and may set `timeoutMs` (200–5000, default 1500).

```json
{ "status": "COMPLETE", "type": "API", "url": "https://router.client.example.com/projexa",
  "fallbackUrl": "https://client.example.com/thanks?uid={respondent_uid}", "timeoutMs": 1500,
  "enabled": true, "callbackRequired": true }
```

When a respondent reaches that status, PROJEXA sends:

```
POST <endpoint>
Content-Type: application/json
X-Projexa-Timestamp: 1793628000
X-Projexa-Signature: sha256=<hex HMAC-SHA256(secret, timestamp + "." + body)>

{"status":"COMPLETE","respondent_uid":"R123","vendor_id":"PALPHA","country_code":"DE","project_code":"PRX10001"}
```

QA studio adds `"test": true`; so does a test session. The endpoint answers `2xx` with `{"url": "https://..."}`.

### Safety rules

- **Validation** blocks saving a usable version unless all of these hold:
  - the mode is hybrid;
  - the endpoint has no macros;
  - the endpoint is on the allowed domains for the rule's scope (the organisation's, plus the vendor's for a vendor rule);
  - the fallback URL is present, passes the same checks as any dynamic URL and may use macros.
- **The answered URL** gets the same allowlist, protocol and loop checks as any other destination. It is used as answered; parameter mappings are not added.
- **Fallback.** A timeout, a non-2xx status, a body that is not JSON, a missing `url`, an answer over 16 KB or a disallowed URL all send the respondent to the fallback URL.
  - The redirect log records `apiFallback = true` with the reason.
  - The bell counts these over 24 hours.
- **No redirects are followed** and nothing is retried, so a respondent waits at most `timeoutMs`.
- **The signing secret** is per organisation and created on first use.
  - Admins see and rotate it in the project's Redirects tab (API destinations), or at `GET /api/v1/organization/redirect-signing-secret` and `POST .../rotate`.
  - Endpoints should reject requests whose timestamp is more than 5 minutes old.
- **The effective routing view** shows `asks <endpoint>` and the fallback, without calling the endpoint.

### Checking the signature (Node)

```js
const ok = req.headers['x-projexa-signature'] ===
  'sha256=' + crypto.createHmac('sha256', SECRET).update(`${req.headers['x-projexa-timestamp']}.${rawBody}`).digest('hex');
```

For local work, the web app has a stand-in endpoint at `/mock/router`.

## Scheduled activation

- **Schedule.** `POST /projects/:id/redirects/versions/:versionId/schedule {"at": "2026-11-03T09:00:00Z"}` approves a draft to go live at that time. In the UI it is Version history → Schedule.
  - The time must be between 1 minute and 90 days ahead.
  - The version must pass validation now.
  - Only one version per project can be scheduled at a time.
- **Cancel or bring forward.** `DELETE .../schedule` cancels and returns the version to draft. "Activate now" still works on a scheduled version.
- **The scheduler** runs every 30 seconds inside the API process. Turn it off with `REDIRECT_SCHEDULER_ENABLED=false`.
  - Each due version is validated again, because domains or vendors may have changed since it was scheduled.
  - If it passes, it is activated in one guarded transaction: the old active version is archived, and the audit action is `redirect.activate-scheduled`. Several API instances can run the scheduler without double-activating.
  - If it fails, it goes back to draft with `scheduleError`, the audit records `redirect.schedule-failed`, and the bell shows "Scheduled redirect change … did not go live". The bell links to the project's Redirects tab.
- **Sessions keep their version.** Respondents already in the survey keep the version they started with.

## Compare versions

`GET /projects/:id/redirects/compare?from=<versionId>&to=<versionId>` returns:

- the mode change;
- each rule added, removed or changed, with a rule identified by status and scope;
- for a changed rule, the fields that differ: type, URL, fallback URL, timeout, enabled, callback;
- parameter mapping changes;
- the number of unchanged rules.

The Redirects tab shows this under Version history → Compare.

## Data

| Change | Notes |
|---|---|
| `Organization.redirectSigningSecret` | Created on first use |
| `RedirectPolicyVersion.scheduledAt` | When a scheduled version goes live |
| `RedirectPolicyVersion.scheduledById` | Who scheduled it |
| `RedirectPolicyVersion.scheduleError` | Why the last scheduled attempt failed |
| `SCHEDULED` state | New value in `RedirectVersionState` |
| `RedirectExecution.apiFallback` | The endpoint failed and the fallback URL was used |

Migration: `20261102135716_redirect_destinations`.
