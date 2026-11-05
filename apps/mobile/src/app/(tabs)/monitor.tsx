import { router } from 'expo-router';
import { useState } from 'react';
import { Alert as RNAlert, Text, View } from 'react-native';
import { FeatureGate } from '@/components/gate';
import { Card, GhostButton, LoadState, Muted, Pill, Progress, Screen, Segmented, statusTone } from '@/components/ui';
import { ago, compact, label } from '@/lib/format';
import { canEdit, useApi, useSession } from '@/lib/session';
import { useTheme } from '@/lib/theme';
import { useLoad } from '@/lib/use-load';

interface Pace { status: string; perDay: number | null; requiredPerDay: number | null; remaining: number; etaDays: number | null; daysLeft: number | null }
interface Market {
  project: { id: string; projectCode: string; name: string };
  country: { id: string; countryCode: string; status: string };
  metrics: { target: number; completes: number; terminates: number; entries24h: number };
  pace: Pace;
  ir: number | null;
  allocations: { id: string; vendor: { name: string }; status: string; metrics: { target: number; completes: number }; pace: Pace }[];
}
interface AlertRow { id: string; severity: string; title: string; detail: string; state: string; autoAction: string | null; lastSeenAt: string; project: { id: string; projectCode: string } | null }

export default function MonitorScreen() {
  return (
    <FeatureGate feature="monitor">
      <Monitor />
    </FeatureGate>
  );
}

function Monitor() {
  const { c } = useTheme();
  const api = useApi();
  const { me } = useSession();
  const editor = canEdit(me?.user.role);
  const m = useLoad<{ generatedAt: string; markets: Market[]; alerts: AlertRow[] }>('/monitor');
  const [tab, setTab] = useState<'pace' | 'alerts'>('pace');

  const alertAction = async (a: AlertRow, what: 'acknowledge' | 'resolve') => {
    try {
      await api.post(`/alerts/${a.id}/${what}`);
      await m.reload();
    } catch (e) {
      RNAlert.alert('Could not update the alert', (e as Error).message);
    }
  };

  const markets = m.data?.markets ?? [];
  const alerts = m.data?.alerts ?? [];
  const behind = markets.filter((x) => ['behind', 'stalled'].includes(x.pace.status)).length;

  return (
    <Screen title="Fieldwork monitor" subtitle={m.data ? `Updated ${ago(m.data.generatedAt)} · ${markets.length} live markets` : undefined} refreshing={m.refreshing} onRefresh={m.reload}>
      <Segmented value={tab} onChange={setTab} options={[{ value: 'pace', label: `Live progress${behind ? ` · ${behind} behind` : ''}` }, { value: 'alerts', label: `Alerts${alerts.length ? ` · ${alerts.length}` : ''}` }]} />
      <LoadState loading={m.loading && !m.data} error={m.error} onRetry={m.reload} empty={!!m.data && (tab === 'pace' ? !markets.length : !alerts.length)} emptyText={tab === 'pace' ? 'No live markets right now.' : 'No open alerts. All quiet.'} />

      {tab === 'pace' &&
        markets.map((mk) => (
          <Card key={mk.country.id} onPress={() => router.push(`/project/${mk.project.id}`)} style={{ gap: 8 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <Text style={{ color: c.text, fontWeight: '800', flex: 1 }} numberOfLines={1}>
                <Text style={{ color: c.primary }}>{mk.project.projectCode}</Text> {mk.country.countryCode} · {mk.project.name}
              </Text>
              <Pill tone={statusTone(mk.pace.status)}>{label(mk.pace.status)}</Pill>
            </View>
            <Progress value={mk.metrics.target ? mk.metrics.completes / mk.metrics.target : 0} />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Muted>{`${compact(mk.metrics.completes)} / ${compact(mk.metrics.target)} · IR ${mk.ir ?? '—'}%`}</Muted>
              <Muted>{mk.pace.perDay === null ? `${mk.metrics.entries24h} entries 24h` : `${mk.pace.perDay}/day${mk.pace.requiredPerDay ? ` (need ${mk.pace.requiredPerDay})` : ''}`}</Muted>
            </View>
            {mk.allocations.slice(0, 4).map((a) => (
              <View key={a.id} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                <Text style={{ color: c.muted, fontSize: 12, flex: 1 }} numberOfLines={1}>{`• ${a.vendor.name}`}</Text>
                <Text style={{ color: c.muted, fontSize: 12 }}>{`${a.metrics.completes}/${a.metrics.target} · ${label(a.pace.status)}`}</Text>
              </View>
            ))}
          </Card>
        ))}

      {tab === 'alerts' &&
        alerts.map((a) => (
          <Card key={a.id} style={{ gap: 8 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
              <Pill tone={statusTone(a.severity)}>{a.severity === 'bad' ? 'Urgent' : a.severity === 'warn' ? 'Warning' : 'Info'}</Pill>
              <Muted>{`${label(a.state)} · ${ago(a.lastSeenAt)}`}</Muted>
            </View>
            <Text style={{ color: c.text, fontWeight: '700' }}>{a.title}</Text>
            <Muted>{a.detail}</Muted>
            {a.autoAction && <Muted>{`Autopilot: ${a.autoAction}`}</Muted>}
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              {a.project && <GhostButton title={a.project.projectCode} icon="folder" onPress={() => router.push(`/project/${a.project!.id}`)} />}
              {editor && a.state === 'OPEN' && <GhostButton title="Acknowledge" icon="eye" onPress={() => alertAction(a, 'acknowledge')} />}
              {editor && <GhostButton title="Resolve" icon="check" tone="good" onPress={() => alertAction(a, 'resolve')} />}
            </View>
          </Card>
        ))}
    </Screen>
  );
}
