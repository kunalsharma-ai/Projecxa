import { useState } from 'react';
import { Text, View } from 'react-native';
import { FeatureGate, OpenOnWeb } from '@/components/gate';
import { Card, LoadState, Muted, Pill, Screen, Segmented, statusTone } from '@/components/ui';
import { query } from '@/lib/api';
import { day, label, money } from '@/lib/format';
import { useTheme } from '@/lib/theme';
import { useLoad } from '@/lib/use-load';

interface Invoice { id: string; number: string; status: string; currency: string; total: number | string; completes: number; issuedAt: string | null; dueAt: string | null; paidAt: string | null; overdue: boolean; project: { projectCode: string; name: string }; client: { name: string } }

export default function InvoicesScreen() {
  return (
    <FeatureGate feature="invoices">
      <Invoices />
    </FeatureGate>
  );
}

function Invoices() {
  const { c } = useTheme();
  const [status, setStatus] = useState<'' | 'DRAFT' | 'SENT' | 'PAID' | 'VOID'>('');
  const list = useLoad<Invoice[]>(`/invoices${query({ status })}`);
  const overdue = list.data?.filter((i) => i.overdue).length ?? 0;
  return (
    <Screen title="Invoices" subtitle={overdue ? `${overdue} overdue` : 'Client invoices'} back refreshing={list.refreshing} onRefresh={list.reload}>
      <Segmented value={status} onChange={setStatus} options={[{ value: '', label: 'All' }, { value: 'DRAFT', label: 'Draft' }, { value: 'SENT', label: 'Sent' }, { value: 'PAID', label: 'Paid' }, { value: 'VOID', label: 'Void' }]} />
      <LoadState loading={list.loading && !list.data} error={list.error} onRetry={list.reload} empty={!!list.data && !list.data.length} emptyText="No invoices." />
      {list.data?.map((i) => (
        <Card key={i.id} style={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ color: c.primary, fontWeight: '800' }}>{i.number}</Text>
            <Pill tone={i.overdue ? 'bad' : statusTone(i.status)}>{i.overdue ? 'Overdue' : label(i.status)}</Pill>
          </View>
          <Text style={{ color: c.text, fontWeight: '800', fontSize: 20 }}>{money(i.total, i.currency)}</Text>
          <Muted>{`${i.client.name} · ${i.project.projectCode} ${i.project.name}`}</Muted>
          <Muted>{`${i.completes} completes · issued ${day(i.issuedAt)} · due ${day(i.dueAt)}${i.paidAt ? ` · paid ${day(i.paidAt)}` : ''}`}</Muted>
        </Card>
      ))}
      <OpenOnWeb path="/invoices" label="Create, send and record payments on web" />
    </Screen>
  );
}
