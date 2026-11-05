import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Share, Text, View } from 'react-native';
import { FeatureGate, OpenOnWeb } from '@/components/gate';
import { Card, GhostButton, Grid, KV, LoadState, Muted, Pill, Progress, Ring, Screen, SectionTitle, Segmented, Stat, statusTone } from '@/components/ui';
import { compact, day, label, money, pct } from '@/lib/format';
import { canEdit, useApi, useSession } from '@/lib/session';
import { useTheme } from '@/lib/theme';
import { useLoad } from '@/lib/use-load';

type Stats = Record<'STARTED' | 'COMPLETE' | 'TERMINATE' | 'QUOTA_FULL' | 'QUALITY_FAIL' | 'DUPLICATE' | 'SECURITY_REJECT' | 'PARTIAL', number>;

interface Allocation {
  id: string;
  status: 'ACTIVE' | 'PAUSED' | 'CLOSED';
  cpi: string | number;
  targetCompletes: number;
  completes: number;
  vendor: { id: string; name: string; code: string };
  entryLink: string;
  testEntryLink: string;
  stats: Stats;
}

interface Country {
  id: string;
  countryCode: string;
  language: string;
  status: string;
  loiMinutes: number;
  irPercent: number;
  cpi: string | number;
  currency: string;
  targetCompletes: number;
  completes: number;
  quotas: { id: string; group: string; name: string; target: number; completes: number; isOpen: boolean }[];
  allocations: Allocation[];
}

interface Project {
  id: string;
  projectCode: string;
  workOrderNo: string | null;
  name: string;
  status: string;
  category: string;
  description: string | null;
  redirectMode: string;
  client: { id: string; name: string };
  projectManager: { name: string } | null;
  salesPerson: { name: string } | null;
  fieldStartAt: string | null;
  fieldEndAt: string | null;
  stats: Stats;
  countries: Country[];
}

type Tab = 'overview' | 'markets' | 'quotas';

export default function ProjectScreen() {
  return (
    <FeatureGate feature="projects">
      <ProjectDetail />
    </FeatureGate>
  );
}

function ProjectDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c } = useTheme();
  const api = useApi();
  const { me } = useSession();
  const editor = canEdit(me?.user.role);
  const p = useLoad<Project>(`/projects/${id}`);
  const [tab, setTab] = useState<Tab>('overview');
  const [busy, setBusy] = useState<string | null>(null);

  const act = async (key: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(key);
    try {
      await fn();
      await p.reload();
      Alert.alert('Done', done);
    } catch (e) {
      Alert.alert('Could not save', (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const setStatus = (status: string) =>
    Alert.alert(`Set project to ${label(status)}?`, status === 'LIVE' ? 'Live markets start accepting respondents.' : 'New respondents are stopped.', [
      { text: 'Cancel', style: 'cancel' },
      { text: label(status), onPress: () => act(`s-${status}`, () => api.patch(`/projects/${id}`, { status }), `Project is now ${label(status)}.`) },
    ]);

  const setAlloc = (country: Country, a: Allocation, status: Allocation['status']) =>
    act(`a-${a.id}`, () => api.patch(`/projects/${id}/countries/${country.id}/allocations/${a.id}`, { status }), `${a.vendor.name} in ${country.countryCode} is ${label(status).toLowerCase()}.`);

  const d = p.data;
  const s = d?.stats;
  const target = d?.countries.reduce((t, x) => t + x.targetCompletes, 0) ?? 0;
  const done = s?.COMPLETE ?? 0;
  const clicks = s ? Object.values(s).reduce((a, b) => a + b, 0) : 0;

  return (
    <Screen title={d?.projectCode ?? 'Project'} subtitle={d?.name} back refreshing={p.refreshing} onRefresh={p.reload}>
      <LoadState loading={p.loading && !d} error={p.error} onRetry={p.reload} />
      {d && s && (
        <>
          <Card style={{ flexDirection: 'row', gap: 16, alignItems: 'center' }}>
            <Ring value={target ? done / target : 0} size={104} label={`${pct(done, target)}%`} sub="complete" />
            <View style={{ flex: 1, gap: 6 }}>
              <Pill tone={statusTone(d.status)}>{label(d.status)}</Pill>
              <Text style={{ color: c.text, fontWeight: '800', fontSize: 16 }} numberOfLines={2}>
                {d.name}
              </Text>
              <Muted>{`${d.client.name} · ${d.countries.length} market${d.countries.length === 1 ? '' : 's'}`}</Muted>
            </View>
          </Card>
          <Segmented<Tab> value={tab} onChange={setTab} options={[{ value: 'overview', label: 'Overview' }, { value: 'markets', label: 'Markets & vendors' }, { value: 'quotas', label: 'Quotas' }]} />

          {tab === 'overview' && (
            <>
              <Grid>
                {[
                  <Stat key="c" icon="check-circle" value={compact(done)} label={`of ${compact(target)} completes`} colors={['#10B981', '#22D3EE']} />,
                  <Stat key="t" icon="x-circle" value={compact(s.TERMINATE)} label="Terminates" colors={['#F43F5E', '#F97316']} />,
                  <Stat key="q" icon="slash" value={compact(s.QUOTA_FULL)} label="Over quota" colors={['#F59E0B', '#EAB308']} />,
                  <Stat key="i" icon="percent" value={`${pct(done, done + s.TERMINATE)}%`} label="Incidence" colors={['#6366F1', '#A855F7']} />,
                  <Stat key="d" icon="user-x" value={compact(s.PARTIAL)} label="Drop-outs" colors={['#64748B', '#94A3B8']} />,
                  <Stat key="f" icon="shield-off" value={compact(s.QUALITY_FAIL + s.DUPLICATE + s.SECURITY_REJECT)} label="Quality fails" colors={['#DB2777', '#9333EA']} />,
                ]}
              </Grid>
              <Card>
                <SectionTitle>Details</SectionTitle>
                <KV k="Work order" v={d.workOrderNo ?? '—'} />
                <KV k="Category" v={d.category} />
                <KV k="Project manager" v={d.projectManager?.name ?? '—'} />
                <KV k="Sales" v={d.salesPerson?.name ?? '—'} />
                <KV k="Field dates" v={`${day(d.fieldStartAt)} – ${day(d.fieldEndAt)}`} />
                <KV k="Redirect mode" v={label(d.redirectMode)} />
                <KV k="Clicks" v={compact(clicks)} />
              </Card>
              {editor && (
                <Card style={{ gap: 10 }}>
                  <SectionTitle>Status</SectionTitle>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {(['LIVE', 'HOLD', 'CLOSED'] as const)
                      .filter((x) => x !== d.status)
                      .map((x) => (
                        <GhostButton key={x} title={x === 'LIVE' ? 'Go live' : x === 'HOLD' ? 'Put on hold' : 'Close'} icon={x === 'LIVE' ? 'play' : x === 'HOLD' ? 'pause' : 'check'} tone={x === 'LIVE' ? 'good' : x === 'HOLD' ? 'warn' : 'neutral'} disabled={!!busy} onPress={() => setStatus(x)} />
                      ))}
                  </View>
                  <Muted>Going live needs everything the web checks (links, redirects); if something is missing the server says what.</Muted>
                </Card>
              )}
              <OpenOnWeb path={`/projects/${d.id}`} label="Open full project on web" />
            </>
          )}

          {tab === 'markets' &&
            d.countries.map((ct) => (
              <Card key={ct.id} style={{ gap: 10 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ color: c.text, fontWeight: '800', fontSize: 16 }}>{`${ct.countryCode} · ${ct.language.toUpperCase()}`}</Text>
                  <Pill tone={statusTone(ct.status)}>{label(ct.status)}</Pill>
                </View>
                <Muted>{`LOI ${ct.loiMinutes} min · IR ${ct.irPercent}% · CPI ${money(ct.cpi, ct.currency)}`}</Muted>
                <Progress value={ct.targetCompletes ? ct.completes / ct.targetCompletes : 0} />
                <Muted>{`${ct.completes} / ${ct.targetCompletes} completes`}</Muted>
                {ct.allocations.map((a) => (
                  <View key={a.id} style={{ borderTopWidth: 1, borderTopColor: c.border, paddingTop: 10, gap: 6 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                      <Text style={{ color: c.text, fontWeight: '700', flex: 1 }} numberOfLines={1}>
                        {a.vendor.name}
                      </Text>
                      <Pill tone={statusTone(a.status)}>{label(a.status)}</Pill>
                    </View>
                    <Muted>{`${a.stats.COMPLETE} / ${a.targetCompletes} completes · ${a.stats.TERMINATE} terms · payout ${money(a.cpi, ct.currency)}`}</Muted>
                    <Progress value={a.targetCompletes ? a.stats.COMPLETE / a.targetCompletes : 0} colors={[c.magenta, c.primary]} height={6} />
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                      <GhostButton title="Share link" icon="share-2" onPress={() => Share.share({ message: a.entryLink })} />
                      <GhostButton title="Test link" icon="share" onPress={() => Share.share({ message: a.testEntryLink })} />
                      {editor && a.status === 'ACTIVE' && <GhostButton title="Pause" icon="pause" tone="warn" disabled={!!busy} onPress={() => setAlloc(ct, a, 'PAUSED')} />}
                      {editor && a.status === 'PAUSED' && <GhostButton title="Resume" icon="play" tone="good" disabled={!!busy} onPress={() => setAlloc(ct, a, 'ACTIVE')} />}
                    </View>
                  </View>
                ))}
                {!ct.allocations.length && <Muted>No vendors on this market yet.</Muted>}
              </Card>
            ))}

          {tab === 'quotas' && (
            <>
              {d.countries.every((ct) => !ct.quotas.length) && <LoadState loading={false} error={null} empty emptyText="No quota cells on this project." />}
              {d.countries
                .filter((ct) => ct.quotas.length)
                .map((ct) => (
                  <Card key={ct.id} style={{ gap: 10 }}>
                    <SectionTitle>{`${ct.countryCode} quotas`}</SectionTitle>
                    {ct.quotas.map((q) => (
                      <View key={q.id} style={{ gap: 4 }}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                          <Text style={{ color: c.text, fontWeight: '600' }}>{`${q.group}: ${q.name}`}</Text>
                          <Text style={{ color: q.isOpen ? c.muted : c.bad, fontSize: 12 }}>{`${q.completes}/${q.target}${q.isOpen ? '' : ' · closed'}`}</Text>
                        </View>
                        <Progress value={q.target ? q.completes / q.target : 0} height={6} />
                      </View>
                    ))}
                  </Card>
                ))}
            </>
          )}
        </>
      )}
    </Screen>
  );
}
