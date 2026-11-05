import { useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { FeatureGate } from '@/components/gate';
import { Card, Field, GhostButton, GradientButton, LoadState, Muted, Pill, Screen, Segmented, statusTone } from '@/components/ui';
import { query } from '@/lib/api';
import { day, label } from '@/lib/format';
import { useApi } from '@/lib/session';
import { useTheme } from '@/lib/theme';
import { useLoad } from '@/lib/use-load';

interface Task {
  id: string;
  title: string;
  description: string | null;
  status: 'OPEN' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  project: { id: string; projectCode: string } | null;
  assignee: { id: string; name: string } | null;
  dueAt: string | null;
  overdue: boolean;
  blocked: boolean;
}

export default function TasksScreen() {
  return (
    <FeatureGate feature="tasks">
      <Tasks />
    </FeatureGate>
  );
}

function Tasks() {
  const { c } = useTheme();
  const api = useApi();
  const [filter, setFilter] = useState<'mine' | 'open' | 'overdue' | 'done'>('mine');
  const params = filter === 'mine' ? { mine: 'true' } : filter === 'overdue' ? { overdue: 'true' } : filter === 'done' ? { status: 'done' } : {};
  const list = useLoad<Task[]>(`/tasks${query(params)}`);
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [adding, setAdding] = useState(false);

  const update = async (t: Task, status: Task['status']) => {
    try {
      await api.patch(`/tasks/${t.id}`, { status });
      await list.reload();
    } catch (e) {
      Alert.alert('Could not update the task', (e as Error).message);
    }
  };
  const add = async () => {
    setAdding(true);
    try {
      await api.post('/tasks', { title: title.trim(), ...(due.trim() ? { dueAt: due.trim() } : {}) });
      setTitle('');
      setDue('');
      await list.reload();
    } catch (e) {
      Alert.alert('Could not add the task', (e as Error).message);
    } finally {
      setAdding(false);
    }
  };

  return (
    <Screen title="Tasks" back refreshing={list.refreshing} onRefresh={list.reload}>
      <Card style={{ gap: 10 }}>
        <Field label="New task" value={title} onChangeText={setTitle} placeholder="e.g. Send quota update to client" />
        <Field label="Due (optional)" value={due} onChangeText={setDue} placeholder="YYYY-MM-DD" autoCapitalize="none" />
        <GradientButton title="Add task" icon="plus" onPress={add} busy={adding} disabled={!title.trim()} />
      </Card>
      <Segmented value={filter} onChange={setFilter} options={[{ value: 'mine', label: 'Mine' }, { value: 'open', label: 'All open' }, { value: 'overdue', label: 'Overdue' }, { value: 'done', label: 'Done' }]} />
      <LoadState loading={list.loading && !list.data} error={list.error} onRetry={list.reload} empty={!!list.data && !list.data.length} emptyText="No tasks here." />
      {list.data?.map((t) => (
        <Card key={t.id} style={{ gap: 8 }}>
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
            <Pill tone={t.overdue ? 'bad' : statusTone(t.status)}>{t.overdue ? 'Overdue' : label(t.status)}</Pill>
            <Pill tone={t.priority === 'URGENT' ? 'bad' : t.priority === 'HIGH' ? 'warn' : 'neutral'}>{label(t.priority)}</Pill>
            {t.blocked && <Pill tone="warn">Blocked</Pill>}
          </View>
          <Text style={{ color: c.text, fontWeight: '700', fontSize: 15 }}>{t.title}</Text>
          {!!t.description && <Muted>{t.description}</Muted>}
          <Muted>{[t.project?.projectCode, t.assignee?.name, t.dueAt ? `due ${day(t.dueAt)}` : null].filter(Boolean).join(' · ')}</Muted>
          {(t.status === 'OPEN' || t.status === 'IN_PROGRESS') && (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {t.status === 'OPEN' && <GhostButton title="Start" icon="play" onPress={() => update(t, 'IN_PROGRESS')} />}
              <GhostButton title="Done" icon="check" tone="good" onPress={() => update(t, 'DONE')} />
            </View>
          )}
        </Card>
      ))}
    </Screen>
  );
}
