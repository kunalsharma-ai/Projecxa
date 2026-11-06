/**
 * One colour per project status, used by the status chip, the status tabs on the projects list,
 * the row stripe and the status menu in the project header:
 * Live green, Hold orange, Closed red, Test blue, Draft grey, Invoiced purple.
 * Tailwind needs whole class names, so every variant is spelled out here.
 */
export interface StatusStyle {
  label: string;
  /** Soft chip: tinted background, coloured text. */
  chip: string;
  /** Solid fill for the selected status (menu button, active tab). */
  solid: string;
  /** Small dot before the label. */
  dot: string;
  /** Left stripe on a list row. */
  stripe: string;
  /** Tab outline before it is picked. */
  tab: string;
  hint: string;
}

export const PROJECT_STATUS_STYLE: Record<string, StatusStyle> = {
  LIVE: { label: 'Live', chip: 'bg-st-live/15 text-st-live ring-1 ring-st-live/30', solid: 'bg-st-live text-white', dot: 'bg-st-live', stripe: 'border-l-st-live', tab: 'border-st-live/40 text-st-live hover:bg-st-live/10', hint: 'Respondents can enter on every ready market' },
  HOLD: { label: 'Hold', chip: 'bg-st-hold/15 text-st-hold ring-1 ring-st-hold/30', solid: 'bg-st-hold text-white', dot: 'bg-st-hold', stripe: 'border-l-st-hold', tab: 'border-st-hold/40 text-st-hold hover:bg-st-hold/10', hint: 'Paused: entry links show the paused page' },
  TEST: { label: 'Test', chip: 'bg-st-test/15 text-st-test ring-1 ring-st-test/30', solid: 'bg-st-test text-white', dot: 'bg-st-test', stripe: 'border-l-st-test', tab: 'border-st-test/40 text-st-test hover:bg-st-test/10', hint: 'Only test links work; nothing is billed' },
  DRAFT: { label: 'Draft', chip: 'bg-st-draft/15 text-st-draft ring-1 ring-st-draft/30', solid: 'bg-st-draft text-white', dot: 'bg-st-draft', stripe: 'border-l-st-draft', tab: 'border-st-draft/40 text-st-draft hover:bg-st-draft/10', hint: 'Being set up; no links work yet' },
  CLOSED: { label: 'Closed', chip: 'bg-st-closed/15 text-st-closed ring-1 ring-st-closed/30', solid: 'bg-st-closed text-white', dot: 'bg-st-closed', stripe: 'border-l-st-closed', tab: 'border-st-closed/40 text-st-closed hover:bg-st-closed/10', hint: 'Fieldwork finished; links show the closed page' },
  INVOICED: { label: 'Invoiced', chip: 'bg-st-invoiced/15 text-st-invoiced ring-1 ring-st-invoiced/30', solid: 'bg-st-invoiced text-white', dot: 'bg-st-invoiced', stripe: 'border-l-st-invoiced', tab: 'border-st-invoiced/40 text-st-invoiced hover:bg-st-invoiced/10', hint: 'Closed and billed to the client' },
};

/** The statuses people pick from the header menu, in field order. */
export const MENU_STATUSES = ['DRAFT', 'TEST', 'LIVE', 'HOLD', 'CLOSED', 'INVOICED'] as const;

/** Only these move in bulk from the projects list: Live → Hold and Hold → Live. */
export const BULK_FROM: Record<'LIVE' | 'HOLD', 'HOLD' | 'LIVE'> = { LIVE: 'HOLD', HOLD: 'LIVE' };
export const canBulkMove = (status: string) => status === 'LIVE' || status === 'HOLD';
