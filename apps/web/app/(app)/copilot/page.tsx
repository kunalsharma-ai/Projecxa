'use client';
import clsx from 'clsx';
import { History, Plus, Trash2 } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { CopilotChat } from '@/components/copilot/chat';
import { api, get } from '@/lib/api';

interface Conv { id: string; title: string; updatedAt: string }

function CopilotPage() {
  const params = useSearchParams();
  const router = useRouter();
  const id = params.get('c');
  const [list, setList] = useState<Conv[]>([]);
  const [showList, setShowList] = useState(false);
  const refresh = useCallback(() => get<Conv[]>('/ai/conversations').then(setList).catch(() => undefined), []);
  useEffect(() => { refresh(); }, [refresh, id]);
  const open = (c: string | null) => { router.replace(c ? `/copilot?c=${c}` : '/copilot'); setShowList(false); };

  return (
    <div className="relative -mx-4 -my-6 flex h-[calc(100dvh-3.5rem)] min-h-0 sm:-mx-6">
      <aside className={clsx('w-64 shrink-0 flex-col border-r border-line bg-panel', showList ? 'absolute inset-y-0 left-0 z-20 flex shadow-lg' : 'hidden md:flex')}>
        <div className="flex items-center justify-between border-b border-line px-3 py-3">
          <span className="text-sm font-semibold">Conversations</span>
          <button className="btn-ghost h-8 px-2 text-xs" onClick={() => open(null)}><Plus className="h-3.5 w-3.5" />New</button>
        </div>
        <nav className="min-h-0 flex-1 overflow-y-auto p-2">
          {list.length === 0 && <p className="px-2 py-2 text-xs text-muted">No conversations yet.</p>}
          {list.map((c) => (
            <div key={c.id} className={clsx('group flex items-center gap-1 rounded-md', c.id === id ? 'bg-brand/10' : 'hover:bg-sunken')}>
              <button className="min-w-0 flex-1 truncate px-2 py-2 text-left text-sm" title={c.title} onClick={() => open(c.id)}>{c.title}</button>
              <button className="mr-1 hidden h-7 w-7 place-items-center rounded text-muted hover:text-bad group-hover:grid" aria-label={`Delete ${c.title}`}
                onClick={async () => { if (!window.confirm('Delete this conversation?')) return; await api(`/ai/conversations/${c.id}`, { method: 'DELETE' }); if (c.id === id) open(null); refresh(); }}>
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </nav>
      </aside>
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold">{list.find((c) => c.id === id)?.title ?? 'AI copilot'}</h1>
          </div>
          <div className="flex gap-2 md:hidden">
            <button className="btn-ghost h-8 px-2 text-xs" onClick={() => setShowList(!showList)}><History className="h-3.5 w-3.5" />History</button>
            <button className="btn-ghost h-8 px-2 text-xs" onClick={() => open(null)}><Plus className="h-3.5 w-3.5" />New</button>
          </div>
        </div>
        <div className="min-h-0 flex-1">
          <CopilotChat conversationId={id} onConversation={(c) => { open(c); refresh(); }} />
        </div>
      </section>
    </div>
  );
}

export default function Page() {
  return <Suspense><CopilotPage /></Suspense>;
}
