# AI copilot and voice assistant

> **Now set up in the app.** An admin adds the Gemini API key and models in **Settings → Integrations** (see `docs/INTEGRATIONS.md`). The environment variables are an optional fallback.

PROJEXA's copilot answers questions about projects, fieldwork, tasks, the team and finance, and proposes changes that a person confirms. It talks to the model through a provider-independent gateway (`apps/api/src/ai/provider.ts`). Google Gemini is the first provider (`gemini.provider.ts`); another provider is a new class implementing `AiProvider`.

## Setup

1. Sign in to Google AI Studio (aistudio.google.com) with the Google account that should own the key, and create an API key in a Google Cloud project used only for PROJEXA.
2. Put it in the API server environment, never in the database or the repo:

   ```
   GEMINI_API_KEY=...
   ```

3. Restart the API. The copilot appears in the menu and as the sparkle button in the header. Admins can tune it in **Settings → AI copilot**.

Optional variables:

| Variable | Default | Meaning |
| --- | --- | --- |
| `AI_MODEL` | `gemini-3.8-flash` | Model for chat, tools and documents |
| `AI_FALLBACK_MODEL` | `gemini-3.5-flash-lite` | Tried once when the main model returns "rate limited"; empty for none |
| `AI_LIVE_MODEL` | `gemini-3.8-live` | Model for spoken conversations |
| `GEMINI_API_URL` | `https://generativelanguage.googleapis.com` | Only changed for testing |

Without `GEMINI_API_KEY` the copilot says it is not set up and makes no calls.

## Models, limits and cost (checked 2026-11-02)

- On Gemini's free tier the stable text models include `gemini-3.8-flash`, `gemini-3.6-flash`, `gemini-3.5-flash-lite` and `gemini-3.1-flash-lite`. The larger `gemini-4-argon` is paid only. `gemini-3.8-live` is the free Live (voice) model.
- Google shows the exact free-tier rate limits only in AI Studio (aistudio.google.com/rate-limit). Limits apply per Google Cloud project; daily limits reset at midnight Pacific time. Over the limit Gemini answers 429, which PROJEXA shows as "The AI service is busy" after one try on the fallback model.
- PROJEXA's own limits sit in front of Gemini (Settings → AI copilot): questions per person per minute (default 8) and per day (100), and per organisation per day (1000). Keep them under your Gemini plan. Tool follow-up rounds inside one question do not count against the person.
- **Data use on the free tier:** Google's terms say free-tier prompts and answers may be used to improve Google's products. That includes the project, client and finance details the copilot looks up. Before using the copilot with confidential client work, turn on billing for the Google Cloud project (paid tier data is not used that way). The settings page shows this warning.

## What it can do

Every tool runs on the server as the person asking, inside their organisation and role. The model never sees a record the person could not open in the app, and tables and charts are built from records, not by the model.

Read tools (all staff roles the admin allows):

- `list_projects`, `project_details`, `fieldwork_status`, `delayed_projects`, `activity_summary` (today's or a period's activity)
- `list_tasks`, `team_workload`, `list_people`
- `performance_report` (overall/client/vendor numbers), `finance_overview`, `list_invoices`, `list_vendor_bills` (money kept per currency)
- `reallocation_suggestions` (quota cells)

Actions (shown as a card; nothing changes until the person presses **Confirm**):

- `create_task` (admins and project managers), `update_task` (editors; others only their own tasks' status and notes)
- `create_project` (asks for LOI, IR and CPI if missing)
- `set_project_status`, `set_vendor_link_status`, `run_fieldwork_check`

A proposal expires after 30 minutes. Role and settings are checked again when it is confirmed. The audit log records `ai.action.proposed`, `ai.action.confirmed`, `ai.action.failed` and `ai.action.cancelled`, plus the normal entry of the change itself (for example `task.create.ai`).

PROJEXA has no teams, departments, budgets or expenses. When asked about them the copilot says so rather than guessing; "the design team" is resolved to a named person.

## Documents

Attach a PDF, image (PNG or JPEG), plain text, Markdown, CSV or JSON file (10 MB max) and ask for a summary, the requirements, or what is missing. PDFs are read by Gemini directly (about 258 tokens per page); Word files must be saved as PDF first. Files are stored in the database for the uploader and can be deleted from the attachment list.

## Project from a brief

Create project can also read a brief into the form with one forced tool call. It uses the same settings and limits, and counts as usage kind `brief`. See `docs/PROJECT_FROM_BRIEF.md`.

## Voice

The microphone button starts a spoken conversation.

1. The server asks Gemini for a single-use token valid for 15 minutes (must start within 60 seconds), bound to the Live model, the system instructions and the tools the person may use. The API key never reaches the browser.
2. The browser streams 16 kHz microphone audio to Gemini Live and plays the spoken answer.
3. When Gemini wants data or an action, the browser forwards the call to `POST /api/v1/ai/voice/tool`, which runs the same server-side tools and confirmation cards as text chat.
4. Each finished turn's transcript is saved with `POST /api/v1/ai/voice/turn`, so voice conversations appear in the history.

If Live cannot start (no AudioWorklet, network, or Gemini refuses), PROJEXA falls back to the browser's speech recognition and speech synthesis with normal text chat, where the browser supports it (Chrome and Edge do; Firefox has no speech recognition).

## API

All under `/api/v1/ai`, signed-in staff only:

| Method | Path | |
| --- | --- | --- |
| GET | `/status` | Whether it is set up, the person's access and usage, and settings for admins |
| PUT | `/settings` | Admin: on/off, roles, actions, documents, voice, limits |
| GET | `/usage` | Admin: usage by day and person |
| POST | `/chat` | `{ conversationId?, message, documentIds?, path? }` |
| GET/DELETE | `/conversations`, `/conversations/:id` | The person's own conversations |
| POST | `/actions/:id/confirm`, `/actions/:id/cancel` | Decide a proposed change |
| GET/POST/DELETE | `/documents`, `/documents/:id` | Upload is multipart field `file` |
| POST | `/voice/session`, `/voice/tool`, `/voice/turn` | Voice, see above |

Tasks: `GET/POST /api/v1/tasks`, `GET/PATCH /api/v1/tasks/:id`.

## Testing

`apps/api/test/e2e/ai.e2e.spec.ts` runs the whole loop against a scripted fake Gemini: tool calls, role scoping, confirmation, expiry, limits, documents and voice. Nothing in the test suite calls the real Gemini, so try it with a real key on a test organisation first.
