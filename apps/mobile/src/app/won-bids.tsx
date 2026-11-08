import { router } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { FeatureGate, OpenOnWeb } from '@/components/gate';
import { Card, GhostButton, LoadState, Muted, Pill, Screen, Segmented, statusTone } from '@/components/ui';
import { query } from '@/lib/api';
import { day, label, money } from '@/lib/format';
import { useTheme } from '@/lib/theme';
import { useLoad } from '@/lib/use-load';

interface WonBid { id: string; bidNumber: string; projectName: string; clientName: string; currency: string; totalAmount: string | null; countries: unknown; wonAt: string; status: string; project: { id: string; projectCode: string } | null }

export default function WonBidsScreen() {
  return (
    <FeatureGate feature="won_bids">
      <WonBids />
    </FeatureGate>
  );
}

function WonBids() {
  const { c } = useTheme();
  const [status, setStatus] = useState<'NEW' | 'PROJECT_CREATED' | 'DISMISSED' | ''>('NEW');
  const list = useLoad<{ counts: Record<string, number>; items: WonBid[] }>(`/won-bids${query({ status })}`);
  const n = (k: string) => list.data?.counts[k] ?? 0;
  return (
    <Screen title="Won bids" subtitle="From SampBidx, waiting for project setup" back refreshing={list.refreshing} onRefresh={list.reload}>
      <Segmented value={status} onChange={setStatus} options={[{ value: 'NEW', label: `New · ${n('NEW')}` }, { value: 'PROJECT_CREATED', label: `Set up · ${n('PROJECT_CREATED')}` }, { value: 'DISMISSED', label: 'Dismissed' }, { value: '', label: 'All' }]} />
      <LoadState loading={list.loading && !list.data} error={list.error} onRetry={list.reload} empty={!!list.data && !list.data.items.length} emptyText="No won bids here." />
      {list.data?.items.map((b) => (
        <Card key={b.id} style={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ color: c.primary, fontWeight: '800' }}>{b.bidNumber}</Text>
            <Pill tone={statusTone(b.status)}>{label(b.status)}</Pill>
          </View>
          <Text style={{ color: c.text, fontWeight: '700', fontSize: 15 }}>{b.projectName}</Text>
          <Muted>{`${b.clientName} · won ${day(b.wonAt)}${b.totalAmount ? ` · ${money(b.totalAmount, b.currency)}` : ''}`}</Muted>
          {Array.isArray(b.countries) && <Muted>{(b.countries as { countryCode?: string; code?: string }[]).map((x) => x.countryCode ?? x.code).filter(Boolean).join(', ')}</Muted>}
          {b.project ? <GhostButton title={`Open ${b.project.projectCode}`} icon="folder" onPress={() => router.push(`/project/${b.project!.id}`)} /> : b.status === 'NEW' ? <OpenOnWeb path={`/projects/new?wonBid=${b.id}`} label="Set up project on web" /> : null}
        </Card>
      ))}
    </Screen>
  );
}
