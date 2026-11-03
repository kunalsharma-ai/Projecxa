# Vendor scoring, capacity and suggestions (milestone 24)

## Scorecards

Every vendor gets a score from 0 to 100 and a grade (A 85+, B 70+, C 55+, D below) from its own traffic over a period (180 days by default; 90 or 365 on the scorecard). Test traffic never counts. A score needs at least 30 clicks; with fewer, the counts are shown without a score.

| Part | Weight | 100 means | 0 means |
| --- | --- | --- | --- |
| Quality | 30% | no quality fail, duplicate or security reject | 25% or more of clicks rejected |
| Client acceptance | 25% | every reconciled complete approved | none approved (needs 10 reconciled completes) |
| Delivery | 20% | finished links reached their target | nothing delivered (links on closed or invoiced projects, closed links, or past the field end date) |
| Incidence | 15% | actual IR at or above the IR the projects expected | 0 completes (needs 20 completes + terminates) |
| Engagement | 10% | no drop-outs | 40% or more dropped (partial, technical error, or expired without an outcome) |

A part without enough data is left out and the other weights are scaled up. Each scorecard lists in words what pulled the score down.

**Vendors** shows each vendor's grade, the markets it covers and the completes it still owes on live projects. Click a vendor for its **scorecard**: the parts, counts, a table per market (score, capacity, owed, room left) and its recent links.

## Capacity

**Edit capacity** on the scorecard sets, per market, the completes a vendor says it can deliver a day and a month, with a note (for example "B2C only"). The markets listed are the ones the vendor covers. "Owed on live projects" is what is still missing on its active links in live and test projects; "room left" is the monthly capacity minus that.

## Suggested vendors

On a project's **Vendors & links** tab, **Suggest vendors** ranks the active vendors not yet on that market:

1. Start from the vendor's score in that market (when it has 30 clicks there), else its overall score, else 50.
2. +15 when it has delivered completes in that market before; +10 when it declares capacity there.
3. −20 when it has neither history nor declared capacity there; such vendors always rank below those that do.
4. −20 when its room left this month is below what the market still needs.
5. −15 when its usual CPI in that market and currency (the median of its links, else the market median) leaves no margin on the client CPI.

Each suggestion shows these reasons, any warnings from its scorecard, and a CPI and target to start from: the usual CPI, and what the market still needs (capped by room left), or a 10% backup when the target is fully allocated. **Add vendor** creates the link with those values, which you can change first.

The AI copilot can answer "which vendors are best in Germany?" with the `vendor_scores` tool.

API: `GET /api/v1/vendors/scores?days=`, `GET /api/v1/vendors/:id/scorecard?days=`, `PUT /api/v1/vendors/:id/capacity`, `GET /api/v1/projects/:id/countries/:countryId/vendor-suggestions`.
