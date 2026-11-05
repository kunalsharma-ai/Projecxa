import { router } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { FeatureGate, OpenOnWeb } from '@/components/gate';
import { Card, Grid, LoadState, Muted, Pill, Screen, Segmented, Stat, statusTone } from '@/components/ui';
import { compact, label } from '@/lib/format';
import { useTheme } from '@/lib/theme';
import { useLoad } from '@/lib/use-load';

interface Health {
  health: string;
  reasons: string[];
  totals: { entries: number; redirects: number; fallbacks: number; blocked: number; apiFallbacks: number };
  projects: { project: { id: string; projectCode: string; name?: string }; health: string; reasons: string[]; redirects: number; fallbacks: number }[];
  callbackHosts: { host: string; delivered: number; failing: number; pending: number; lastError: string | null }[];
}

export default function RedirectHealthScreen() {
  return (
    <FeatureGate feature="redirect_health">
      <RedirectHealth />
    </FeatureGate>
  );
}

function RedirectHealth() {
  const { c } = useTheme();
  const [w, setW] = useState<'1h' | '24h' | '7d'>('24h');
  const h = useLoad<Health>(`/redirect-health?window=${w}`);
  const d = h.data;
  return (
    <Screen title="Redirect health" back refreshing={h.refreshing} onRefresh={h.reload}>
      <Segmented value={w} onChange={setW} options={[{ value: '1h', label: 'Last hour' }, { value: '24h', label: '24 hours' }, { value: '7d', label: '7 days' }]} />
      <LoadState loading={h.loading && !d} error={h.error} onRetry={h.reload} />
      {d && (
        <>
          <Card style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{ color: c.text, fontWeight: '800', fontSize: 18 }}>Overall</Text>
            <Pill tone={statusTone(d.health)}>{label(d.health)}</Pill>
          </Card>
          {d.reasons.map((r) => (
            <Muted key={r}>{`• ${r}`}</Muted>
          ))}
          <Grid>
            {[
              <Stat key="e" icon="log-in" value={compact(d.totals.entries)} label="Entries" colors={['#0EA5E9', '#22D3EE']} />,
              <Stat key="r" icon="corner-up-right" value={compact(d.totals.redirects)} label="Redirects" colors={['#7C3AED', '#C026D3']} />,
              <Stat key="f" icon="alert-triangle" value={compact(d.totals.fallbacks)} label="Fallbacks" colors={['#F59E0B', '#F97316']} />,
              <Stat key="b" icon="slash" value={compact(d.totals.blocked)} label="Blocked" colors={['#F43F5E', '#DB2777']} />,
            ]}
          </Grid>
          {d.projects.map((p) => (
            <Card key={p.project.id} onPress={() => router.push(`/project/${p.project.id}`)} style={{ gap: 4 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: c.text, fontWeight: '700' }}>{p.project.projectCode}</Text>
                <Pill tone={statusTone(p.health)}>{label(p.health)}</Pill>
              </View>
              <Muted>{`${compact(p.redirects)} redirects · ${compact(p.fallbacks)} fallbacks`}</Muted>
              {p.reasons.slice(0, 2).map((r) => (
                <Muted key={r}>{r}</Muted>
              ))}
            </Card>
          ))}
          {d.callbackHosts.filter((x) => x.failing).map((x) => (
            <Card key={x.host} style={{ gap: 4 }}>
              <Text style={{ color: c.text, fontWeight: '700' }}>{`Callbacks to ${x.host}`}</Text>
              <Muted>{`${x.failing} failing · ${x.pending} pending · ${x.delivered} delivered`}</Muted>
              {!!x.lastError && <Muted>{x.lastError}</Muted>}
            </Card>
          ))}
        </>
      )}
      <OpenOnWeb path="/redirect-health" label="Charts and link checks on web" />
    </Screen>
  );
}
