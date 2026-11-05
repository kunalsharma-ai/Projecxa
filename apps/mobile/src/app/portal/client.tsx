import { router } from 'expo-router';
import { Text, View } from 'react-native';
import { FeatureGate, OpenOnWeb, Wordmark } from '@/components/gate';
import { Card, GhostButton, LoadState, Muted, Pill, Progress, Screen, SectionTitle, Stat, statusTone } from '@/components/ui';
import { label } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useTheme } from '@/lib/theme';
import { useLoad } from '@/lib/use-load';

interface Project { id: string; projectCode: string; name: string; status: string; countries: string[]; targetCompletes: number; completes: number; pendingApprovals: number }

/** Client users: their own projects and what waits for their approval. Never vendor data. */
export default function ClientPortalScreen() {
  return (
    <FeatureGate feature="portal.client">
      <ClientPortal />
    </FeatureGate>
  );
}

function ClientPortal() {
  const { c } = useTheme();
  const { me } = useSession();
  const s = useLoad<{ client: { name: string }; pendingApprovals: number }>('/portal/client/summary');
  const p = useLoad<Project[]>('/portal/client/projects');
  const reload = () => {
    s.reload();
    p.reload();
  };
  return (
    <Screen title={me?.client?.name ?? 'Client portal'} subtitle="Your projects" refreshing={p.refreshing} onRefresh={reload} right={<GhostButton title="" icon="user" onPress={() => router.push('/account')} />}>
      <Wordmark />
      {s.data && <Stat icon="check-square" value={String(s.data.pendingApprovals)} label="Completes waiting for your approval" />}
      <SectionTitle>Projects</SectionTitle>
      <LoadState loading={p.loading && !p.data} error={p.error} onRetry={reload} empty={!!p.data && !p.data.length} emptyText="No projects to show yet." />
      {p.data?.map((x) => (
        <Card key={x.id} style={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ color: c.primary, fontWeight: '800' }}>{x.projectCode}</Text>
            <Pill tone={statusTone(x.status)}>{label(x.status)}</Pill>
          </View>
          <Text style={{ color: c.text, fontWeight: '700' }}>{x.name}</Text>
          <Muted>{x.countries.join(', ')}</Muted>
          <Progress value={x.targetCompletes ? x.completes / x.targetCompletes : 0} />
          <Muted>{`${x.completes} / ${x.targetCompletes} completes${x.pendingApprovals ? ` · ${x.pendingApprovals} to approve` : ''}`}</Muted>
        </Card>
      ))}
      <OpenOnWeb path="/portal/client" label="Approve completes, invoices and files on web" />
    </Screen>
  );
}
