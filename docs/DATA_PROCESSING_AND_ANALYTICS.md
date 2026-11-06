# Data processing & quality, and Reporting & analytics

Two pages from panels 10 and 11 of Kunal's *SampTrek Neon Project Management Suite* mockup, in the
Neon Command look (docs/NEON_DESIGN.md). Both sit in the sidebar under **Fieldwork** and work on one
project at a time (pick it at the top; the page remembers it in the address as `?project=`). With no
project chosen they open the most recently changed live project that has traffic.

Every number comes from data SampTrek already collects. Nothing is sample data, and steps SampTrek does
not do are not shown as if it did (see "What is not here").

## Data processing & quality — `/data-processing`

| Tab | What it shows |
| --- | --- |
| **Data intake** | Processing progress ring (average of the pipeline steps) and the pipeline: **Data intake** (entrants with an outcome), **Data validation** (completes confirmed server-to-server by the survey platform), **Quality checks** (pass rate of SampTrek's entry checks; a rate, so not in the average), **Review & reconciliation** (completes approved or rejected, by hand, in the client portal or by a client ID list), **Quota balance** (completes towards each quota cell, capped at its target; market targets when there are no cells) and **Final delivery & billing** (approved completes on a client invoice). Below: outcomes of all entrants. |
| **Validation** | Verified completes, entry-check pass rate, possible speeders (completes in under a third of the planned LOI), entrants still in the survey; reasons entrants were removed or screened out; device mix. |
| **Cleaning** | Quality by vendor (entrants, completes, removed by checks, duplicates, security, quality fail, client-rejected, median minutes, quality score = share of entrants not removed and not rejected); the latest 25 removed or rejected respondents; review and last reconciliation, with a link to reconcile. |
| **Quota balance** | Every quota cell (or market target) with completes / target. |
| **Export** | **Clean data (CSV)**: every complete that was not rejected (pending ones are included, marked PENDING), with session token, vendor respondent ID, vendor, market, device, approval, verification, start/finish, minutes and every gate and prescreener answer (up to 20,000 rows). Links to the Answers, Respondents and Reconcile tabs, Analytics and Reports. |

API: `GET /api/v1/data-processing?projectId=` and `GET /api/v1/data-processing/clean?projectId=`.

## Reporting & analytics — `/analytics`

| Tab | What it shows |
| --- | --- |
| **Dashboard** | KPIs: N completes (of target, approved), median interview length vs planned LOI, completes in the last 7 days vs the week before, number of key insights (with actual vs planned incidence). Column chart of the crosstab's row variable, donut of any question or field (pick it), completes per day for 30 days, and **key insights**: plain statements worked out with fixed rules (no AI), with a link to ask the AI copilot for a written summary. |
| **Crosstabs** | Any two of: outcome, market, vendor, device, and every gate/prescreener single, multi, dropdown or number question (numbers are grouped into five ranges). Column percentages and counts, base row, shaded cells, CSV. Base: completes, all finished entrants, or every entrant. |
| **Analysis** | Answer counts and shares for every choice and number question; CSV of all counts. |
| **Deliverables** | Deliverable and questionnaire files uploaded to the project (Files & requests tab), and downloads: crosstab CSV, answer counts CSV, clean data file, project reports. |

API: `GET /api/v1/analytics?projectId=&base=completes|finished|all&row=&col=&focus=` where row, col and
focus are `status`, `country`, `vendor`, `device`, `gate:<question id>` or `prescreen:<question id>`.

Both endpoints are staff only and scoped to the caller's organisation (another organisation's project
is 404). They read up to the newest 100,000 non-test sessions of the project; the page says so when a
project is bigger.

## What is not here, on purpose

* **Weighting** (mockup step): SampTrek balances the sample *during* fieldwork with quota cells; it does
  not weight data afterwards. The step is shown as *Quota balance* and the page says so.
* **Satisfaction scores, brand consideration, purchase intent** (mockup tiles): these are answers to the
  client's own questionnaire, which stays in the client's survey platform. SampTrek only has the gate and
  prescreener answers, outcomes, devices, markets, vendors and timing, and the charts use those.
* **Open-end coding / recoding**: text answers stay in the Answers tab and the clean data file.

## Access

Both pages follow the Super Admin feature switches (docs/SUPER_ADMIN.md): `data_processing` and
`analytics` (web; the mobile app does not have these screens yet). They are in every starter plan. Plans
that were already saved before this change do not have them yet: the Super Admin ticks them in
Super Admin → Plans. A per-organisation or per-user switch can turn them off; the sidebar hides them,
the page says it is not part of your access, and the API answers 403.

Tests: `apps/api/test/e2e/data-analytics.e2e.spec.ts`.
