import clsx from 'clsx';

export type Grade = 'A' | 'B' | 'C' | 'D' | null;
export interface ScoreParts { quality: number | null; acceptance: number | null; delivery: number | null; incidence: number | null; engagement: number | null }
export interface VendorStats {
  clicks: number;
  completes: number;
  terminates: number;
  quotaFull: number;
  quality: number;
  drops: number;
  approved: number;
  rejected: number;
  expectedIr: number | null;
  delivery: number | null;
  finishedLinks: number;
  projects: number;
  conversion: number;
  qualityRate: number;
  rejectionRate: number | null;
}

const TONE: Record<string, string> = { A: 'bg-ok/15 text-ok', B: 'bg-info/15 text-info', C: 'bg-warn/15 text-warn', D: 'bg-bad/15 text-bad' };

/** Grade letter with the score, or a dash while there is not enough data. */
export function ScoreBadge({ score, grade, size = 'sm' }: { score: number | null; grade: Grade; size?: 'sm' | 'lg' }) {
  if (score === null || !grade) return <span className="text-xs text-muted" title="Not enough data yet">No score yet</span>;
  return (
    <span className={clsx('inline-flex items-center gap-1.5 rounded-full font-semibold tabular-nums', TONE[grade], size === 'lg' ? 'px-3 py-1 text-base' : 'px-2 py-0.5 text-xs')} title={`Score ${score} of 100`}>
      {grade}
      <span className="font-medium opacity-80">{score}</span>
    </span>
  );
}

export const PART_LABELS: Record<keyof ScoreParts, [string, string]> = {
  quality: ['Quality', 'Clicks not rejected for quality, duplicates or security (25% rejected scores 0)'],
  acceptance: ['Client acceptance', 'Reconciled completes approved by clients'],
  delivery: ['Delivery', 'Share of target reached on finished links'],
  incidence: ['Incidence', 'Actual IR against the IR the projects expected'],
  engagement: ['Engagement', 'Clicks that did not drop out (40% dropping scores 0)'],
};
export const WEIGHTS: Record<keyof ScoreParts, number> = { quality: 30, acceptance: 25, delivery: 20, incidence: 15, engagement: 10 };

export function PartBar({ value }: { value: number | null }) {
  if (value === null) return <span className="text-xs text-muted">Not enough data</span>;
  const tone = value >= 85 ? 'bg-ok' : value >= 70 ? 'bg-info' : value >= 55 ? 'bg-warn' : 'bg-bad';
  return (
    <span className="flex items-center gap-2">
      <span className="h-2 w-full min-w-[80px] overflow-hidden rounded-full bg-sunken"><span className={clsx('block h-full rounded-full', tone)} style={{ width: `${value}%` }} /></span>
      <span className="w-8 text-right text-xs tabular-nums">{value}</span>
    </span>
  );
}
