# SampTrek → SAMPLEON: audiences from SUPPLY360 panels

SAMPLEON is the Sampledge audience, invitation and routing engine (repository
`kunalsharma-ai/Sampleon`; design in its `docs/ECOSYSTEM_ARCHITECTURE.md`). For a SampTrek
project the flow is:

```
SampTrek project → SAMPLEON audience request → SUPPLY360 panelists → ZAPX survey → SAMPLEON → SampTrek
```

**Who owns what.** SampTrek owns the project, its requirements, budgets, milestones, project-level
targets and approved changes, progress tracking and reporting. SAMPLEON owns targeting,
feasibility, the human approval of the audience, invitations, live quota counting and routing.
SUPPLY360 owns the respondents. ZAPX hosts the survey. SampTrek therefore keeps no respondent list
and no second quota counter for SAMPLEON respondents: SAMPLEON's completes are shown next to
(not added to) the completes SampTrek routed itself through its vendors.

## Setup

Set `SAMPLEON_URL`, `SAMPLEON_CLIENT_ID` (default `projexa`) and `SAMPLEON_CLIENT_SECRET` on the
API (`apps/api/.env.example`). In SAMPLEON, register client `projexa` (system `PROJEXA`, the identifier SampTrek still sends as `source.platform`) with the
same secret and the webhook URL `{SAMPTREK_API}/api/v1/integrations/sampleon/events`.

## Ask SAMPLEON for an audience

`POST /api/v1/projects/{id}/sampleon/audience-requests` (admins and project managers):

```json
{
  "surveyId": "<ZAPX survey id>",
  "launchUrl": "https://take.zapx.example/s/<survey>?vid=SAMPLEON&uid={token}",
  "targeting": { "naturalLanguage": "Find 1,500 cardiologists in the USA, UK and Germany with at least five years of professional experience for SampTrek Project PRJ-1045." },
  "rewardPoints": 1500
}
```

The launch URL comes from ZAPX (`POST /api/surveys/{id}/sampleon/connect`). SampTrek fills in the
rest from the project: countries, target completes per country (languages of one country add up),
the longest LOI, the IR weighted by target, the fieldwork dates (or `fieldwork` in the body), the
project code as `source.projectId`, and the organisation. `targeting.criteria` and `hostId` are
optional. Quotas are the project's own quota cells, translated as described below, unless
`quotas` (in SAMPLEON's format) are given or `useProjectQuotas` is `false`. The answer lists the
quotas sent and the cells left out. Nothing reaches a respondent until a person approves the
audience in SAMPLEON.

In the web app the same is on the project's **SAMPLEON** tab: the requests with their status and
SAMPLEON completes, a form to request an audience, **Send changes** for approved changes, and the
quota mapping.

## Quota cells as SUPPLY360 quotas

SampTrek cells count respondents by gate or prescreener answers; SAMPLEON counts its respondents by
their SUPPLY360 profile. Each question a cell uses is therefore mapped once to a SUPPLY360 profile
attribute (read from SAMPLEON's `GET /api/v1/attributes`), and each answer to one of the
attribute's values. Answers whose label matches a value or one of its synonyms are matched
automatically; yes/no answers match boolean attributes. Number questions map to number
attributes, and a cell's range becomes `between`, `gte` or `lte`.

- `GET /api/v1/projects/{id}/sampleon/quotas`: the catalogue, the saved map, each used question
  with its attribute (saved, or **suggested** from the question and answer wording), the quotas that
  would be sent, and the cells that would not, with the reason.
- `PUT /api/v1/projects/{id}/sampleon/quotas` `{ map: { "gate:<questionId>": { attribute, values: { <answerId>: value } } } }`
  (admins and project managers) saves the map after checking every attribute and value against
  the catalogue.

A suggestion is never sent until a person saves it. Cells are left out when they use device (known
only when the respondent opens the survey), a question or answer that is not mapped, a removed
question, or when they are closed. Cells of the languages of one country with the same conditions
are added up into one SAMPLEON quota (`pjx-<cellId>`). SampTrek keeps counting its own cells for the
respondents it routes itself; SAMPLEON counts its quotas for the respondents it invites.

## Approved changes

After changing targets or fieldwork dates in SampTrek,
`POST /api/v1/projects/{id}/sampleon/{requestId}/sync` sends them to SAMPLEON
(`PATCH /api/v1/audience-requests/{AR-id}`), where quota targets update in place. A request sent
with the project's quota cells also re-sends them, translated with the current map.

## Progress

SAMPLEON's events arrive at `POST /api/v1/integrations/sampleon/events`, signed with
`X-Sampledge-Client: sampleon`, `X-Sampledge-Timestamp` and
`X-Sampledge-Signature: v1=hex HMAC-SHA256(secret, ts.POST.path.sha256(rawBody))` (300 seconds).
Each `eventId` is applied once. `GET /api/v1/projects/{id}/sampleon` shows each request's status
(`submitted → feasibility_ready → approved → soft_launch/live → closed`), completes, remaining and
the latest per-country snapshot.

## Tests

`apps/api/test/e2e/sampleon.e2e.spec.ts`, `apps/api/test/unit/sampleon-quotas.spec.ts` (the
translation), and SAMPLEON's `e2e/ecosystem/run.mjs`, which runs the
workflow with SampTrek, SAMPLEON, SUPPLY360 and ZAPX together.
