import { useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { FeatureGate, OpenOnWeb } from '@/components/gate';
import { Card, Field, GhostButton, LoadState, Muted, Pill, Screen, statusTone } from '@/components/ui';
import { label } from '@/lib/format';
import { useTheme } from '@/lib/theme';
import { useLoad } from '@/lib/use-load';

interface Client { id: string; name: string; code: string; status: string; contacts: { id: string; name: string; email: string | null; phone?: string | null }[]; _count: { projects: number } }

export default function ClientsScreen() {
  return (
    <FeatureGate feature="clients">
      <Clients />
    </FeatureGate>
  );
}

function Clients() {
  const { c } = useTheme();
  const [q, setQ] = useState('');
  const list = useLoad<Client[]>('/clients');
  const rows = (list.data ?? []).filter((x) => !q || `${x.name} ${x.code}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <Screen title="Clients" subtitle={list.data ? `${list.data.length} clients` : undefined} back refreshing={list.refreshing} onRefresh={list.reload}>
      <Field label="Search" value={q} onChangeText={setQ} placeholder="Name or code" autoCapitalize="none" />
      <LoadState loading={list.loading && !list.data} error={list.error} onRetry={list.reload} empty={!!list.data && !rows.length} emptyText="No clients." />
      {rows.map((x) => (
        <Card key={x.id} style={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <Text style={{ color: c.text, fontWeight: '700', fontSize: 15, flex: 1 }}>{x.name}</Text>
            <Pill tone={statusTone(x.status)}>{label(x.status)}</Pill>
          </View>
          <Muted>{`${x.code} · ${x._count.projects} project${x._count.projects === 1 ? '' : 's'}`}</Muted>
          {(x.contacts ?? []).slice(0, 2).map((ct) => (
            <View key={ct.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Muted>{ct.name}</Muted>
              {!!ct.email && <GhostButton title="Email" icon="mail" onPress={() => Linking.openURL(`mailto:${ct.email}`)} />}
              {!!ct.phone && <GhostButton title="Call" icon="phone" onPress={() => Linking.openURL(`tel:${ct.phone}`)} />}
            </View>
          ))}
        </Card>
      ))}
      <OpenOnWeb path="/clients" label="Add or edit clients on web" />
    </Screen>
  );
}
