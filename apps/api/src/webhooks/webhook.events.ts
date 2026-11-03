/** Events an endpoint can subscribe to. Payloads are documented in docs/PUBLIC_API.md. */
export const WEBHOOK_EVENTS = {
  'session.completed': 'A respondent completed a survey (live traffic only, after quota checks).',
  'project.status_changed': 'A project moved to another status, for example LIVE or CLOSED.',
  'alert.opened': 'The fieldwork monitor opened a new alert.',
  'invoice.status_changed': 'A client invoice was sent, paid or voided.',
  'bill.status_changed': 'A vendor bill was approved, paid or voided.',
} as const;

export type WebhookEvent = keyof typeof WEBHOOK_EVENTS;
export const EVENT_NAMES = Object.keys(WEBHOOK_EVENTS) as WebhookEvent[];
