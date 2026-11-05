import { router } from 'expo-router';
import { Share, Text, View } from 'react-native';
import { FeatureGate, OpenOnWeb, Wordmark } from '@/components/gate';
import { Card, GhostButton, Grid, LoadState, Muted, Pill, Progress, Screen, SectionTitle, Stat } from '@/components/ui';
import { compact, money } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useTheme } from '@/lib/theme';
import { useLoad } from '@/lib/use-load';

interface Summary { vendor: { name: string }; liveAllocations: number; clicks: number; conversion: number; stats: Record<string, number>; payout: Record<'approved' | 'pending' | 'rejected', { completes: number; payout: number }> }
interface Allocation { id: string; project: { projectCode: string; name: string }; countryCode: string; loiMinutes: number; irPercent: number; status: string; accepting: boolean; cpi: string; currency: string; targetCompletes: number; completes: number; entryLink: string; testEntryLink: string; stats: Record<string, number> }

/** Vendor (panel) users: their live links, completes and payouts. Never client prices. */
export default function VendorPortalScreen() {
  return (
    <FeatureGate feature="portal.vendor">
      <VendorPortal />
    </FeatureGate>
  );
}

function VendorPortal() {
  const { c } = useTheme();
  const { me } = useSession();
  const s = useLoad<Summary>('/portal/vendor/summary');
  const a = useLoad<Allocation[]>('/portal/vendor/allocations');
  const reload = () => {
    s.reload();
    a.reload();
  };
  return (
    <Screen title={me?.vendor?.name ?? 'Vendor portal'} subtitle="Your links, completes and payouts" refreshing={s.refreshing} onRefresh={reload} right={<GhostButton title="" icon="user" onPress={() => router.push('/account')} />}>
      <Wordmark />
      <LoadState loading={s.loading && !s.data} error={s.error} onRetry={reload} />
      {s.data && (
        <Grid>
          {[
            <Stat key="l" icon="link" value={String(s.data.liveAllocations)} label="Live links" colors={['#0EA5E9', '#22D3EE']} />,
            <Stat key="c" icon="check-circle" value={compact(s.data.stats.COMPLETE ?? 0)} label="Completes" colors={['#7C3AED', '#C026D3']} />,
            <Stat key="v" icon="percent" value={`${s.data.conversion}%`} label="Conversion" colors={['#F59E0B', '#F97316']} />,
            <Stat key="p" icon="clock" value={compact(s.data.payout.pending.completes)} label="Awaiting approval" colors={['#10B981', '#22C55E']} />,
          ]}
        </Grid>
      )}
      <SectionTitle>Your projects</SectionTitle>
      <LoadState loading={a.loading && !a.data} error={a.error} onRetry={a.reload} empty={!!a.data && !a.data.length} emptyText="No projects assigned to you yet." />
      {a.data?.map((x) => (
        <Card key={x.id} style={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ color: c.primary, fontWeight: '800' }}>{`${x.project.projectCode} · ${x.countryCode}`}</Text>
            <Pill tone={x.accepting ? 'good' : 'neutral'}>{x.accepting ? 'Accepting' : 'Not accepting'}</Pill>
          </View>
          <Text style={{ color: c.text, fontWeight: '700' }}>{x.project.name}</Text>
          <Muted>{`LOI ${x.loiMinutes} min · IR ${x.irPercent}% · ${money(x.cpi, x.currency)} per complete`}</Muted>
          <Progress value={x.targetCompletes ? x.completes / x.targetCompletes : 0} />
          <Muted>{`${x.completes} / ${x.targetCompletes} completes · ${x.stats.TERMINATE ?? 0} terminates`}</Muted>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <GhostButton title="Share live link" icon="share-2" onPress={() => Share.share({ message: x.entryLink })} />
            <GhostButton title="Test link" icon="share" onPress={() => Share.share({ message: x.testEntryLink })} />
          </View>
        </Card>
      ))}
      <OpenOnWeb path="/portal/vendor" label="Statements, disputes and files on web" />
    </Screen>
  );
}
