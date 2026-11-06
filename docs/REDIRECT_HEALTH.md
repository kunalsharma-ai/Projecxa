# Redirect health (Milestone 34)

`/redirect-health` (nav: **Redirect health**, all staff) answers one question: are respondents reaching the right place? It covers every project or one project (`?project=<id>`) over the last hour, 24 hours or 7 days. It refreshes every minute.

It reads only what SampTrek already records, so there is nothing to set up. Test traffic is always left out.

| Source | What it shows |
| --- | --- |
| `RedirectExecution` | Redirects routed vs fell back, why they fell back, p50/p95 redirect time, redirects that used an API rule's fallback |
| `RespondentSession` | Entries; respondents who went to the client survey and never came back (session expired with no outcome); respondents who left at the gate page |
| `CallbackDelivery` | Vendor callbacks delivered, pending, retrying and given up, by receiving host. Callbacks that need a person can be sent again (editors). |

## Health labels

Each project gets a label. The organisation's label is its worst project's, so one broken study is never averaged away.

| Label | When |
| --- | --- |
| **Failing** | 20% or more of redirects fell back (at least 5 redirects), p95 redirect time of 2 s or more, or a vendor callback gave up (failed or dead letter) |
| **Watch** | 5% or more fell back, p95 of 800 ms or more, vendor callbacks retrying, or at least half of entries (at least 10 expired) never came back from the survey |
| **Healthy** | Traffic and none of the above |
| **No traffic** | Live project with nothing in the window |

The thresholds live in `THRESHOLDS` in `apps/api/src/redirect-health/redirect-health.ts`, and the page quotes them. The reasons are listed under each project. Fallback reasons are grouped when they differ only in details such as a host name, a URL or a number.

Callback URLs often carry respondent IDs and signatures, so the page shows them without their query string.

## Survey link check

**Check survey links** (editors) opens each live market's client survey link once:
- The macros are filled with the test token `projexa-link-check`.
- Redirects are not followed.
- 2xx and 3xx count as reachable; 404, 5xx, timeouts (8 s) and connection errors are reported.
- From a project's view only that project's markets are checked, including markets that are not live yet.

Safety:
- Only `https` links are checked (`http` is allowed outside production).
- Links with credentials are refused.
- Hosts that resolve to private, loopback or link-local addresses are refused, so the check cannot reach the server's own network. An operator can lift that for an on-premises survey host with `LINK_CHECK_ALLOW_PRIVATE=true`.
- Each run is audited as `redirects.links_checked`.

The client's survey platform may record the check as a visit.

## API

- `GET /api/v1/redirect-health?window=1h|24h|7d&projectId=` (any staff user)
- `POST /api/v1/redirect-health/check-links` and `POST /api/v1/redirect-health/check-links/:projectId` (editors)

## Where it is linked

- Navigation and the command palette.
- The command center's Fieldwork health widget.
- Each project's Redirects tab.
- The Fieldwork monitor is one click away from the page header.
