import { router } from 'expo-router';
import { FeatureGate } from '@/components/gate';
import { Card, LoadState, Muted, Pill, Row, Screen, SectionTitle, statusTone } from '@/components/ui';
import { ago } from '@/lib/format';
import { featureForRoute } from '@/lib/features';
import { appRoute } from '@/lib/push';
import { useSession } from '@/lib/session';
import { useLoad } from '@/lib/use-load';
import type { Insights } from './(tabs)/home';


export default function NotificationsScreen() {
  return (
    <FeatureGate feature="notifications">
      <Notifications />
    </FeatureGate>
  );
}

function Notifications() {
  const { access } = useSession();
  const ins = useLoad<Insights>('/insights');
  const open = (href: string) => {
    const r = appRoute(href);
    const f = featureForRoute(r);
    if (f && access.allowed.has(f.key)) router.push(r as never);
  };
  return (
    <Screen title="Notifications" back refreshing={ins.refreshing} onRefresh={ins.reload}>
      <LoadState loading={ins.loading && !ins.data} error={ins.error} onRetry={ins.reload} empty={!!ins.data && !ins.data.items.length} emptyText="You are all caught up." />
      {!!ins.data?.items.length && (
        <Card>
          <SectionTitle>Needs attention</SectionTitle>
          {ins.data.items.map((i) => (
            <Row key={i.id} title={i.title} subtitle={i.detail} onPress={() => open(i.href)} right={<Pill tone={statusTone(i.severity)}>{i.severity === 'bad' ? 'Urgent' : i.severity === 'warn' ? 'Check' : 'Info'}</Pill>} />
          ))}
        </Card>
      )}
      {!!ins.data?.activity.length && (
        <Card>
          <SectionTitle>Recent activity</SectionTitle>
          {ins.data.activity.map((a) => (
            <Row key={a.id} icon="clock" title={`${a.actor}: ${a.action.replace(/[._]/g, ' ')}`} subtitle={`${a.entityType} · ${ago(a.at)}`} />
          ))}
        </Card>
      )}
      <Muted style={{ textAlign: 'center' }}>Pull down to refresh.</Muted>
    </Screen>
  );
}
