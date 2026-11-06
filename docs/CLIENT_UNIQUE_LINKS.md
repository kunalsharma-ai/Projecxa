# Client unique links

Some clients do not give one shared live survey link; they send a list of links, one per respondent
(each link can be used once on their side). SampTrek stores those links per market and hands each
respondent the next unused one. Asked for by Kunal on 2026-11-06, together with renaming the older
feature to **Vendor unique links** ([UNIQUE_LINKS.md](UNIQUE_LINKS.md)).

| | Vendor unique links | Client unique links |
|---|---|---|
| Who makes them | SampTrek | The client |
| Who gets them | A vendor, one per respondent | Each respondent, when they enter |
| Replaces | The shared vendor entry link | The market's live survey link |
| Tab | Vendor unique links | Client unique links |

## Where

Project → **Client unique links** tab. Viewers see everything; editors upload, switch markets on and
off, and remove unused links.

1. **Upload**: pick the market, then an Excel file (.xlsx), a CSV/text file, or paste the links (one per
   line). **Check links** reports how many are new, already uploaded to that market, repeated in the file,
   or not links. **Add** saves them. Up to 50,000 links per upload and 200,000 per market. Excel files are
   read in the browser (first cell in each row that starts with http) and sent as text.
2. **Use client unique links**: switch it on per market. From then on the market's live survey link is
   not used. A live market cannot be switched on with no unused links.
3. **Links**: every link with its upload name, Unused / Given out, the respondent UID it went to, the
   vendor, the outcome and when. Filter, search and download as CSV.
4. **Remove unused** deletes the unused links of a market. Links given out stay for the record.

The tab also shows a worked example of the flow (vendor link → client link with the UID → back to SampTrek).

## How respondents get a link

- At entry (or after the gate page, when the project has one), a live respondent is given the next unused
  link of their market, lowest upload order first. One guarded SQL statement
  (`UPDATE … WHERE id = (SELECT … FOR UPDATE SKIP LOCKED) RETURNING url`) hands it out, so two respondents
  can never get the same link, also under load (`apps/api/src/client-links/client-links.ts`, `claimClientLink`).
- Reloading the gate page returns the same link to the same respondent.
- The respondent UID (session token, with the organisation's UID prefix, see
  [WORK_ORDERS_AND_UID_PREFIX.md](WORK_ORDERS_AND_UID_PREFIX.md)) is put into the link: in place of
  `{session_token}` when the link has it, otherwise as `token=`. `{country_code}` and `{project_code}` work too.
  The client survey sends the respondent back to `/r/{status}?token=…` as usual.
- **None left**: the respondent is recorded as Technical error with detail `NO_CLIENT_LINK` and sent to the
  technical error page. The Markets table warns (**low**) when unused links are fewer than twice the
  completes still needed, since drop-outs use links too.
- **Test links** use the market's test survey link; without one they borrow the first unused client link
  without using it up.
- **Going live**: a market with client unique links on needs unused links instead of a live survey link
  (`launchProblems` in `apps/api/src/projects/markets.ts`).

## API

All under `/api/v1/projects/:id/client-links` (staff; writes need Admin or Project manager):

| Method | Path | |
|---|---|---|
| GET | `/summary` | Markets with on/off, unused, given out, low; uploads |
| GET | `/?countryId&status=UNUSED\|ASSIGNED&q&skip&take` | Links |
| GET | `/export.csv` | Same filters, as CSV |
| POST | `/` | JSON `{ countryId, urls[], label?, dryRun? }` |
| POST | `/file` | multipart: `file` (text/CSV, ≤ 15 MB), `countryId`, `label?`, `dryRun` |
| POST | `/countries/:countryId/mode` | `{ useClientLinks }` |
| POST | `/remove` | `{ countryId, ids? }` removes unused links |

Data: `ClientUniqueLink` (url, seq, status UNUSED/ASSIGNED, sessionId, assignedAt, label) and
`ProjectCountry.useClientLinks`. Tests: `apps/api/test/e2e/clients-vendors-links.e2e.spec.ts`.
