# Quota cells

A market (project country) has a target, and each vendor link has its own target. Quota cells split the market further, for example by gender, age band, company size or device.

## Setting them up

Project → **Quotas** tab → **Add cells** / **Edit cells** for a market.

- **Group** is a label for the table (Gender, Age). It has no effect on matching.
- **Conditions** decide who counts. All conditions of a cell must match, so a cell with *Gender: Female* and *Age 18–34* only counts young women (interlocking).
  - **Device**: desktop, mobile, tablet, or the phone system Android / iOS (known at entry). An Android or iOS value matches any device with that system, so "Device: iOS" counts iPhones. Quick add by device makes desktop / mobile / tablet cells only, so cells do not overlap.
  - **Gate survey / prescreener** questions of type single, dropdown or multi: pick one or more answers (any one matches; for multi, any chosen answer matches).
  - **Number** questions: an inclusive range (min, max or both).
  - Text and grid questions cannot be used.
- **Quick add** makes one cell per answer of a choice question (or per device) with an even split of the market target.
- A respondent can count in several cells (one per group, typically).

Saving replaces the market's cells. Cells kept keep their counts; removed cells stop being tracked. The API checks every condition against the project's current questions and rejects cells that point at a missing question, a missing option or a text question.

Answer cells need the gate survey or prescreener to be on (Gate & security). Without it, only device cells can match, and the tab says so.

## How it is enforced

1. **Entry**: device cells are matched. If a matching cell is full or closed the respondent goes to quota full (`statusDetail = CELL_FULL`).
2. **Gate page**: once the answers are validated, all cells are matched again. The result is logged as a `quota` check in the gate security event. A screen-out still wins (terminate before quota full).
3. The cells the respondent matched are stored on the session (`quotaCellIds`).
4. **Complete**: in one transaction, each stored cell, the market and the vendor link are incremented only if they still have room (`completes < target`, cell open). If any of them is full, everything taken is given back and the respondent is recorded as quota full / `OVERQUOTA`. This keeps concurrent completes from overfilling a cell.

Test links match cells but are never stopped by them and never count.

## Running fieldwork

- The table shows completes against target, respondents who qualified and are still in the survey, and Open / Full / Closed.
- **Close** a cell to stop a group early without changing its target; **Open** to resume.
- The fieldwork monitor shows each market's cells when you expand it, and raises an info alert (`cell_full`) when an open cell fills.

## API

| Method | Path | Who |
|---|---|---|
| GET | `/projects/:id/quotas` | staff |
| PUT | `/projects/:id/countries/:countryId/quotas` `{ cells: [{ id?, group, name, target, isOpen, conditions }] }` | admin, project manager |
| PATCH | `/projects/:id/countries/:countryId/quotas/:quotaId` `{ isOpen?, target? }` | admin, project manager |

Condition shape: `{ source: "device" | "gate" | "prescreen", questionId?, values?: string[], min?, max? }`.
