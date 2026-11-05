import { useState } from 'react';
import { Text, View } from 'react-native';
import { FeatureGate, OpenOnWeb } from '@/components/gate';
import { Card, Field, LoadState, Muted, Pill, Screen, statusTone } from '@/components/ui';
import { label } from '@/lib/format';
import { useTheme } from '@/lib/theme';
import { useLoad } from '@/lib/use-load';

interface Vendor { id: string; name: string; code: string; status: string; _count: { allocations: number } }
interface Score { id: string; score: number | null; grade: string | null }

export default function VendorsScreen() {
  return (
    <FeatureGate feature="vendors">
      <Vendors />
    </FeatureGate>
  );
}

function Vendors() {
  const { c } = useTheme();
  const [q, setQ] = useState('');
  const list = useLoad<Vendor[]>('/vendors');
  const scores = useLoad<{ vendors: Score[] }>('/vendors/scores');
  const scoreList = scores.data?.vendors ?? [];
  const rows = (list.data ?? []).filter((x) => !q || `${x.name} ${x.code}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <Screen title="Vendors" subtitle={list.data ? `${list.data.length} panels and suppliers` : undefined} back refreshing={list.refreshing} onRefresh={list.reload}>
      <Field label="Search" value={q} onChangeText={setQ} placeholder="Name or code" autoCapitalize="none" />
      <LoadState loading={list.loading && !list.data} error={list.error} onRetry={list.reload} empty={!!list.data && !rows.length} emptyText="No vendors." />
      {rows.map((v) => {
        const s = scoreList.find((x) => x.id === v.id);
        return (
          <Card key={v.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ width: 48, height: 48, borderRadius: 14, borderWidth: 1, borderColor: c.border, backgroundColor: c.cardStrong, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: c.primary, fontWeight: '900', fontSize: 18 }}>{s?.grade ?? '–'}</Text>
              {s?.score !== null && s?.score !== undefined && <Text style={{ color: c.muted, fontSize: 9 }}>{s.score}</Text>}
            </View>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={{ color: c.text, fontWeight: '700' }}>{v.name}</Text>
              <Muted>{`${v.code} · ${v._count.allocations} allocation${v._count.allocations === 1 ? '' : 's'}`}</Muted>
            </View>
            <Pill tone={statusTone(v.status)}>{label(v.status)}</Pill>
          </Card>
        );
      })}
      <OpenOnWeb path="/vendors" label="Scorecards, capacity and sign-ups on web" />
    </Screen>
  );
}
