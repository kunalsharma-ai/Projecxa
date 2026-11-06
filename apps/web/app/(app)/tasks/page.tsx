'use client';
import clsx from 'clsx';
import { Plus, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { canEdit, useMe } from '@/components/me';
import { Empty, ErrorBox, Loading, PageHeader, Section } from '@/components/ui';
import { get, patch, post } from '@/lib/api';
import { Label } from '@/components/help';

type Status = 'OPEN' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';
type Priority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
interface Task {
  id: string; title: string; description: string | null; status: Status; priority: Priority;
  project: { id: string; projectCode: string; name: string } | null; assignee: { id: string; name: string } | null; createdBy: { name: string } | null;
  dueAt: string | null; remindAt: string | null; blockedBy: { id: string; title: string; status: Status } | null; blocked: boolean; overdue: boolean; source: string;
}
interface Person { id: string; name: string; role: string }
interface ProjectRef { id: string; projectCode: string; name: string }

const VIEWS = [
  { id: 'mine', label: 'Mine', q: 'mine=true' },
  { id: 'open', label: 'All open', q: '' },
  { id: 'overdue', label: 'Overdue', q: 'overdue=true' },
  { id: 'done', label: 'Done', q: 'status=done' },
] as const;
const PRIORITY: Record<Priority, string> = { URGENT: 'bg-bad/15 text-bad', HIGH: 'bg-warn/15 text-warn', MEDIUM: 'bg-sunken text-muted', LOW: 'bg-sunken text-muted' };
const STATUS_LABEL: Record<Status, string> = { OPEN: 'Open', IN_PROGRESS: 'In progress', DONE: 'Done', CANCELLED: 'Cancelled' };
const day = (d: string | null) => (d ? new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '–');

export default function TasksPage() {
  const me = useMe();
  const editor = canEdit(me);
  const [view, setView] = useState<(typeof VIEWS)[number]['id']>('mine');
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [projects, setProjects] = useState<ProjectRef[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [adding, setAdding] = useState(false);
  const blank = { title: '', description: '', assigneeId: '', projectId: '', priority: 'MEDIUM' as Priority, dueAt: '', remindAt: '', blockedById: '' };
  const [form, setForm] = useState(blank);

  const load = useCallback(() => {
    const q = VIEWS.find((v) => v.id === view)!.q;
    get<Task[]>(`/tasks${q ? `?${q}` : ''}`).then(setTasks).catch(setError);
  }, [view]);
  useEffect(() => { setTasks(null); load(); }, [load]);
  useEffect(() => {
    if (!editor) return;
    get<Person[]>('/users').then(setPeople).catch(() => undefined);
    get<{ items: ProjectRef[] }>('/projects?pageSize=100').then((r) => setProjects(r.items)).catch(() => undefined);
  }, [editor]);

  async function create() {
    setError(null);
    try {
      const body = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v === '' ? null : v]));
      await post('/tasks', { ...body, priority: form.priority });
      setForm(blank);
      setAdding(false);
      load();
    } catch (e) {
      setError(e);
    }
  }
  async function setStatus(t: Task, status: Status) {
    setError(null);
    try {
      const r = await patch<Task>(`/tasks/${t.id}`, { status });
      setTasks((cur) => cur?.map((x) => (x.id === t.id ? r : x)) ?? null);
    } catch (e) {
      setError(e);
    }
  }
  const mayChange = (t: Task) => editor || t.assignee?.id === me?.user.id;

  return (
    <>
      <PageHeader
        title="Tasks"
        subtitle="Work for people on the team, with due dates, reminders and what each task waits for. The AI copilot can create them too, after you confirm."
        actions={editor && <button className="btn-primary" onClick={() => setAdding(!adding)}><Plus className="h-4 w-4" />New task</button>}
      />
      <ErrorBox error={error} />
      {adding && (
        <Section title="New task" className="mb-6" actions={<div className="flex gap-2"><button className="btn-ghost" onClick={() => setAdding(false)}>Cancel</button><button className="btn-primary" disabled={!form.title.trim()} onClick={create}>Create task</button></div>}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block sm:col-span-2"><Label>Title</Label><input className="input" value={form.title} maxLength={200} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
            <label className="block"><Label>Assignee</Label>
              <select className="input" value={form.assigneeId} onChange={(e) => setForm({ ...form, assigneeId: e.target.value })}><option value="">Unassigned</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
            </label>
            <label className="block"><Label>Priority</Label>
              <select className="input" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as Priority })}>{(['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as Priority[]).map((p) => <option key={p} value={p}>{p[0] + p.slice(1).toLowerCase()}</option>)}</select>
            </label>
            <label className="block sm:col-span-2"><Label>Project</Label>
              <select className="input" value={form.projectId} onChange={(e) => setForm({ ...form, projectId: e.target.value })}><option value="">No project</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.projectCode} · {p.name}</option>)}</select>
            </label>
            <label className="block"><Label>Due</Label><input type="date" className="input" value={form.dueAt} onChange={(e) => setForm({ ...form, dueAt: e.target.value })} /></label>
            <label className="block"><Label>Remind on</Label><input type="date" className="input" value={form.remindAt} onChange={(e) => setForm({ ...form, remindAt: e.target.value })} /></label>
            <label className="block sm:col-span-2"><Label>Waits for</Label>
              <select className="input" value={form.blockedById} onChange={(e) => setForm({ ...form, blockedById: e.target.value })}><option value="">Nothing</option>{(tasks ?? []).filter((t) => t.status === 'OPEN' || t.status === 'IN_PROGRESS').map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}</select>
            </label>
            <label className="block sm:col-span-2"><Label>Notes</Label><input className="input" value={form.description} maxLength={5000} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
          </div>
        </Section>
      )}
      <div className="mb-4 flex flex-wrap gap-2">
        {VIEWS.map((v) => <button key={v.id} className={clsx('chip px-3 py-1.5 text-sm', view === v.id ? 'bg-brand text-brand-ink' : 'bg-sunken text-ink hover:bg-line')} onClick={() => setView(v.id)}>{v.label}</button>)}
      </div>
      {!tasks ? <Loading /> : tasks.length === 0 ? <Empty>{view === 'mine' ? 'Nothing assigned to you.' : view === 'overdue' ? 'Nothing overdue.' : 'No tasks here.'}</Empty> : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead><tr><th className="th w-8" /><th className="th">Task</th><th className="th">Assignee</th><th className="th">Priority</th><th className="th">Due</th><th className="th">Status</th></tr></thead>
            <tbody>
              {tasks.map((t) => (
                <tr key={t.id} className="border-t border-line align-top" data-task={t.title}>
                  <td className="td"><input type="checkbox" aria-label={`Mark ${t.title} done`} checked={t.status === 'DONE'} disabled={!mayChange(t) || t.status === 'CANCELLED'} onChange={(e) => setStatus(t, e.target.checked ? 'DONE' : 'OPEN')} /></td>
                  <td className="td">
                    <div className={clsx('font-medium', t.status === 'DONE' && 'text-muted line-through')}>{t.title}{t.source === 'ai' && <span className="chip ml-2 bg-brand/10 text-brand" title="Created with the AI copilot"><Sparkles className="h-3 w-3" />AI</span>}</div>
                    <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted">
                      {t.project && <Link href={`/projects/${t.project.id}`} className="text-brand hover:underline">{t.project.projectCode} {t.project.name}</Link>}
                      {t.blocked && <span className="text-warn">Waits for: {t.blockedBy?.title}</span>}
                      {t.remindAt && <span>Reminder {day(t.remindAt)}</span>}
                      {t.description && <span className="truncate">{t.description}</span>}
                    </div>
                  </td>
                  <td className="td">{t.assignee?.name ?? <span className="text-muted">Unassigned</span>}</td>
                  <td className="td"><span className={clsx('chip', PRIORITY[t.priority])}>{t.priority[0] + t.priority.slice(1).toLowerCase()}</span></td>
                  <td className={clsx('td whitespace-nowrap', t.overdue && 'font-medium text-bad')}>{day(t.dueAt)}{t.overdue && ' · overdue'}</td>
                  <td className="td">
                    {mayChange(t) ? (
                      <select className="input w-36 py-1 text-xs" aria-label={`Status of ${t.title}`} value={t.status} onChange={(e) => setStatus(t, e.target.value as Status)}>
                        {(Object.keys(STATUS_LABEL) as Status[]).filter((s) => editor || s !== 'CANCELLED').map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                      </select>
                    ) : STATUS_LABEL[t.status]}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
