# PROJEXA → SAMPLEON: audiences from SUPPLY360 panels

SAMPLEON is the Sampledge audience, invitation and routing engine (repository
`kunalsharma-ai/Sampleon`; design in its `docs/ECOSYSTEM_ARCHITECTURE.md`). For a PROJEXA
project the flow is:

```
PROJEXA project → SAMPLEON audience request → SUPPLY360 panelists → ZAPX survey → SAMPLEON → PROJEXA
```

**Who owns what.** PROJEXA owns the project, its requirements, budgets, milestones, project-level
targets and approved changes, progress tracking and reporting. SAMPLEON owns targeting,
feasibility, the human approval of the audience, invitations, live quota counting and routing.
SUPPLY360 owns the respondents. ZAPX hosts the survey. PROJEXA therefore keeps no respondent list
and no second quota counter for SAMPLEON respondents: SAMPLEON's completes are shown next to
(not added to) the completes PROJEXA routed itself through its vendors.

## Setup

Set `SAMPLEON_URL`, `SAMPLEON_CLIENT_ID` (default `projexa`) and `SAMPLEON_CLIENT_SECRET` on the
API (`apps/api/.env.example`). In SAMPLEON, register client `projexa` (system `PROJEXA`) with the
same secret and the webhook URL `{PROJEXA_API}/api/v1/integrations/sampleon/events`.

## Ask SAMPLEON for an audience

`POST /api/v1/projects/{id}/sampleon/audience-requests` (admins and project managers):

```json
{
  "surveyId": "<ZAPX survey id>",
  "launchUrl": "https://take.zapx.example/s/<survey>?vid=SAMPLEON&uid={token}",
  "targeting": { "naturalLanguage": "Find 1,500 cardiologists in the USA, UK and Germany with at least five years of professional experience for PROJEXA Project PRJ-1045." },
  "rewardPoints": 1500
}
```

The launch URL comes from ZAPX (`POST /api/surveys/{id}/sampleon/connect`). PROJEXA fills in the
rest from the project: countries, target completes per country (languages of one country add up),
the longest LOI, the IR weighted by target, the fieldwork dates (or `fieldwork` in the body), the
project code as `source.projectId`, and the organisation. `targeting.criteria`, `quotas` (in
SAMPLEON's format, on SUPPLY360 attributes) and `hostId` are optional. PROJEXA's own quota cells
are not translated. Nothing reaches a respondent until a person approves the audience in SAMPLEON.

## Approved changes

After changing targets or fieldwork dates in PROJEXA,
`POST /api/v1/projects/{id}/sampleon/{requestId}/sync` sends them to SAMPLEON
(`PATCH /api/v1/audience-requests/{AR-id}`), where quota targets update in place.

## Progress

SAMPLEON's events arrive at `POST /api/v1/integrations/sampleon/events`, signed with
`X-Sampledge-Client: sampleon`, `X-Sampledge-Timestamp` and
`X-Sampledge-Signature: v1=hex HMAC-SHA256(secret, ts.POST.path.sha256(rawBody))` (300 seconds).
Each `eventId` is applied once. `GET /api/v1/projects/{id}/sampleon` shows each request's status
(`submitted → feasibility_ready → approved → soft_launch/live → closed`), completes, remaining and
the latest per-country snapshot.

## Tests

`apps/api/test/e2e/sampleon.e2e.spec.ts`, and SAMPLEON's `e2e/ecosystem/run.mjs`, which runs the
workflow with PROJEXA, SAMPLEON, SUPPLY360 and ZAPX together.
