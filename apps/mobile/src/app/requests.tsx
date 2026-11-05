import { router } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { FeatureGate } from '@/components/gate';
import { Card, LoadState, Muted, Pill, Screen, Segmented, statusTone } from '@/components/ui';
import { query } from '@/lib/api';
import { ago, label } from '@/lib/format';
import { useTheme } from '@/lib/theme';
import { useLoad } from '@/lib/use-load';

export interface Ticket {
  id: string;
  ref: string;
  kind: string;
  status: string;
  subject: string;
  client?: { name: string } | null;
  vendor?: { name: string } | null;
  project: { projectCode: string } | null;
  createdBy: string;
  messages: number;
  disputedCompletes: number;
  lastMessageAt: string | null;
  createdAt: string;
}

export default function RequestsScreen() {
  return (
    <FeatureGate feature="requests">
      <Requests />
    </FeatureGate>
  );
}

function Requests() {
  const { c } = useTheme();
  const [status, setStatus] = useState<'OPEN' | 'ANSWERED' | 'CLOSED' | ''>('OPEN');
  const list = useLoad<Ticket[]>(`/requests${query({ status })}`);
  return (
    <Screen title="Requests" subtitle="Client and vendor tickets" back refreshing={list.refreshing} onRefresh={list.reload}>
      <Segmented value={status} onChange={setStatus} options={[{ value: 'OPEN', label: 'Open' }, { value: 'ANSWERED', label: 'Answered' }, { value: 'CLOSED', label: 'Closed' }, { value: '', label: 'All' }]} />
      <LoadState loading={list.loading && !list.data} error={list.error} onRetry={list.reload} empty={!!list.data && !list.data.length} emptyText="No requests." />
      {list.data?.map((t) => (
        <Card key={t.id} onPress={() => router.push(`/request/${t.id}`)} style={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ color: c.primary, fontWeight: '800' }}>{t.ref}</Text>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {t.kind === 'DISPUTE' && <Pill tone="bad">Dispute</Pill>}
              <Pill tone={statusTone(t.status)}>{label(t.status)}</Pill>
            </View>
          </View>
          <Text style={{ color: c.text, fontWeight: '700' }}>{t.subject}</Text>
          <Muted>{[t.client?.name ?? t.vendor?.name, t.project?.projectCode, `${t.messages} message${t.messages === 1 ? '' : 's'}`, ago(t.lastMessageAt ?? t.createdAt)].filter(Boolean).join(' · ')}</Muted>
        </Card>
      ))}
    </Screen>
  );
}
