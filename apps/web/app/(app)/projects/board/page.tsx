'use client';
import clsx from 'clsx';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { GanttTimeline, HealthRadar, KanbanBoard, type Board } from '@/components/dashboard/board';
import { ErrorBox, Loading, PageHeader } from '@/components/ui';
import { get } from '@/lib/api';

/** Project board (docs/NEON_DESIGN.md): every project as a Kanban by stage and as a Gantt timeline. */
export default function ProjectBoardPage() {
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [tab, setTab] = useState<'kanban' | 'timeline'>('kanban');
  useEffect(() => {
    get<Board>('/dashboard/board?full=1').then(setBoard).catch(setError);
  }, []);
  if (error && !board) return <ErrorBox error={error} />;
  if (!board) return <Loading label="Loading the project board" />;
  return (
    <>
      <PageHeader title="Project board" subtitle="Every project by stage and on a timeline. Open a card to work on the project." actions={<Link href="/projects" className="btn-ghost">Project list</Link>} />
      <div className="mb-5 flex gap-1 overflow-x-auto border-b border-line" role="tablist">
        {(['kanban', 'timeline'] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={clsx('-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-sm', tab === t ? 'border-brand font-medium text-brand' : 'border-transparent text-muted hover:text-ink')}>
            {t === 'kanban' ? 'Kanban' : 'Gantt timeline'}
          </button>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="@container min-w-0">{tab === 'kanban' ? <KanbanBoard columns={board.kanban} /> : <GanttTimeline items={board.timeline} />}</div>
        <HealthRadar health={board.health} />
      </div>
    </>
  );
}
