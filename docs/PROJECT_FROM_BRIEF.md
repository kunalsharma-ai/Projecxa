# Project from a brief (Milestone 35)

Set up a project from a client brief or RFQ in one step:
1. **Projects → From a brief**, or **Create project → Read a brief**.
2. Attach the brief (PDF, image or text, up to 10 MB) or paste it.
3. The AI fills the Create project form.
4. You check the values and press **Create**.

Nothing is created until you press Create.

## What it fills

| Form field | From the brief |
| --- | --- |
| Project name, type, category | Title, or topic and audience; tracker or qualitative when stated; the closest of the form's categories |
| Client | Matched to an existing client by name or code. Otherwise the banner offers **Add it as a client**. |
| Description | A short summary, then the brief's quotas and notes as bullet lists, then the file name |
| Fieldwork dates | Start and end (new on the Create project form, used for pacing on the fieldwork monitor) |
| Devices | Only when the brief limits them |
| Shared LOI, IR, CPI, target group, survey link | Figures that apply to every market; https survey links only |
| Markets | One row per country with language, completes and any market-specific LOI, IR, CPI and audience. The currency is the brief's, or the market's usual one. |

Above the form, a banner shows:
- every field that was filled;
- what the brief does not say (for example the incidence rate or the survey link);
- any warnings;
- **Where the values came from**: short quotes from the brief for the key figures.

## Checks

The model's answer is never trusted as is. `normalizeBrief` (`apps/api/src/ai/brief.ts`) applies the Create project form's own limits:
- **Numbers:** LOI 1–240 minutes, rounded up. Incidence 1–100%; 0.25 is read as 25%. Prices 0–100,000, and "€4.50" or "1,200" are read as numbers. Completes 1–1,000,000.
- **Dates:** must be real dates, and the start must not be after the end.
- **Markets:** must be real ISO country codes. UK is read as GB; EU, UN and private-use codes are refused. Duplicate markets are dropped.
- **Survey links:** https only, with no credentials.

Anything that fails is left empty with a warning, never guessed. The result is saved as **your own project draft**, so it autosaves, survives a reload and appears under "Continue where you left off". The 20-draft limit applies.

## AI and safety

- Uses the organisation's AI provider and settings (Settings → AI copilot):
  - the AI must be on for the person's role;
  - attaching files needs **Document reading** (pasting text does not);
  - each brief counts as one AI request against the per-minute and daily limits, recorded as usage kind `brief`;
  - if the main model is rate-limited or unavailable, the fallback model is tried.
- Only people who can create projects (editors) can use it.
- The model gets one tool, `project_brief`, and must call it. It cannot run any other tool or change anything. The system prompt treats the brief as third-party data and tells the model to ignore instructions inside it.
- The prompt lists your organisation's active client names, so the model can match one. No other organisation's data is sent.
- Each read is audited (`ai.brief.read`) with the file name, the fields filled and the gaps. The file itself is not stored.
- On the free Gemini tier, Google may use prompts to improve its products, so turn on billing before sending confidential briefs (see `docs/AI_COPILOT.md`).

## API

`POST /api/v1/ai/brief`, editors only.
- Request: multipart with a `file`, or JSON `{ "text": "…" }` (40–100,000 characters).
- Returns `{ draftId, title, brief }`. Open `/projects/new?draft=<draftId>` to review.
- Errors:
  - 400: an unusable file or text;
  - 403: AI off for the role, or file reading off;
  - 422: no project found in the document;
  - 429: AI limits reached;
  - 503: AI not set up.
