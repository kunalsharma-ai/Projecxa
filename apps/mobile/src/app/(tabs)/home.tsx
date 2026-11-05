import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { FeatureGate, useOpenWeb, Wordmark } from '@/components/gate';
import { Bars, Card, Grid, IconTile, LoadState, Muted, Pill, Progress, Ring, Row, Screen, SectionTitle, Stat, statusTone, type Icon } from '@/components/ui';
import { compact, money, pct, trendLabel, ago } from '@/lib/format';
import { FEATURES } from '@/lib/features';
import { useSession } from '@/lib/session';
import { useTheme } from '@/lib/theme';
import { useLoad } from '@/lib/use-load';

export interface Dashboard {
  clients: { total: number; active: number };
  vendors: { total: number; active: number };
  projects: { total: number; byStatus: Record<string, number> };
  completes: number;
  clicks: number;
  redirectHealth24h: { total: number; fallbacks: number };
  liveProjects: { id: string; projectCode: string; name: string; target: number; completes: number }[];
  period: {
    current: { revenue: number; cost: number; profit: number; clicks: number; completes: number; currencies: string[] };
    trend: { completes: number | null; clicks: number | null; revenue: number | null; profit: number | null };
    converted: { currency: string; current: { revenue: number; cost: number; profit: number }; trend: { revenue: number | null; profit: number | null } };
  };
  top: { vendors: { id: string; label: string; completes: number; revenue: number }[] };
}

export interface Insights {
  items: { id: string; severity: 'info' | 'warn' | 'bad'; title: string; detail: string; href: string }[];
  alerts: number;
  activity: { id: string; action: string; entityType: string; at: string; actor: string }[];
}

const LIFECYCLE: { label: string; icon: Icon; feature?: string; route?: string }[] = [
  { label: 'Won bid', icon: 'award', feature: 'won_bids', route: '/won-bids' },
  { label: 'Project setup', icon: 'settings', feature: 'projects', route: '/projects' },
  { label: 'Sample allocation', icon: 'users', feature: 'projects', route: '/projects' },
  { label: 'Fieldwork', icon: 'activity', feature: 'monitor', route: '/monitor' },
  { label: 'Reporting', icon: 'bar-chart-2', feature: 'reports', route: '/reports' },
  { label: 'Invoice', icon: 'file-text', feature: 'invoices', route: '/invoices' },
  { label: 'Closure', icon: 'check-circle', feature: 'projects', route: '/projects' },
];

export default function HomeScreen() {
  return (
    <FeatureGate feature="dashboard">
      <Home />
    </FeatureGate>
  );
}

function Home() {
  const { c } = useTheme();
  const { me, access } = useSession();
  const web = useOpenWeb();
  const d = useLoad<Dashboard>('/dashboard');
  const ins = useLoad<Insights>(access.allowed.has('notifications') ? '/insights' : null);
  const reload = () => {
    d.reload();
    ins.reload();
  };
  const data = d.data;
  const live = data?.projects.byStatus.LIVE ?? 0;
  const target = data?.liveProjects.reduce((a, p) => a + p.target, 0) ?? 0;
  const done = data?.liveProjects.reduce((a, p) => a + p.completes, 0) ?? 0;
  const conv = data?.period.converted;
  const margin = conv && conv.current.revenue ? Math.round((conv.current.profit / conv.current.revenue) * 1000) / 10 : null;
  const actions = [
    { key: 'projects.create', label: 'New project', icon: 'plus' as Icon, go: () => web.open('/projects/new') },
    { key: 'copilot', label: 'Ask copilot', icon: 'zap' as Icon, go: () => router.push('/copilot') },
    { key: 'reports', label: 'Reports', icon: 'bar-chart-2' as Icon, go: () => router.push('/reports') },
    { key: 'tasks', label: 'Tasks', icon: 'check-square' as Icon, go: () => router.push('/tasks') },
    { key: 'invoices', label: 'Invoices', icon: 'file-text' as Icon, go: () => router.push('/invoices') },
    { key: 'vendors', label: 'Vendors', icon: 'truck' as Icon, go: () => router.push('/vendors') },
  ].filter((a) => access.allowed.has(a.key) && (a.key !== 'projects.create' || web.available));

  return (
    <Screen
      title="Command center"
      subtitle={me ? `Hi ${me.user.name.split(' ')[0]} · ${me.organization.name}` : undefined}
      refreshing={d.refreshing}
      onRefresh={reload}
      right={
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {access.allowed.has('notifications') && (
            <Pressable accessibilityRole="button" accessibilityLabel={`Notifications, ${ins.data?.alerts ?? 0} need attention`} onPress={() => router.push('/notifications')} style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: c.card, borderColor: c.border, borderWidth: 1, alignItems: 'center', justifyContent: 'center' }}>
              <Feather name="bell" size={18} color={c.text} />
              {!!ins.data?.alerts && (
                <View style={{ position: 'absolute', top: 6, right: 6, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: c.bad, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 }}>
                  <Text style={{ color: '#fff', fontSize: 9, fontWeight: '800' }}>{ins.data.alerts > 99 ? '99+' : ins.data.alerts}</Text>
                </View>
              )}
            </Pressable>
          )}
          <Pressable accessibilityRole="button" accessibilityLabel="Account" onPress={() => router.push('/account')}>
            <LinearGradient colors={[c.cyan, c.magenta]} style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: '#fff', fontWeight: '800' }}>{(me?.user.name ?? '?').slice(0, 1).toUpperCase()}</Text>
            </LinearGradient>
          </Pressable>
        </View>
      }
    >
      {/* Hero, as in the Research Command Centre mockup */}
      <LinearGradient colors={[`${c.accent[0]}EE`, `${c.accent[1]}CC`]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ borderRadius: 24, padding: 18, gap: 10 }}>
        <Wordmark onDark />
        <Text style={{ color: '#fff', fontSize: 22, fontWeight: '900', lineHeight: 27 }}>Your end-to-end research project command center</Text>
        <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 13 }}>Plan · Program · Execute · Monitor · Deliver</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingTop: 4 }}>
          {LIFECYCLE.filter((s) => !s.feature || access.allowed.has(s.feature)).map((s, i) => (
            <Pressable key={s.label} accessibilityRole="button" onPress={() => s.route && router.push(s.route as never)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.16)', borderColor: 'rgba(255,255,255,0.35)', borderWidth: 1, borderRadius: 999, paddingVertical: 7, paddingHorizontal: 12 }}>
              <Feather name={s.icon} size={14} color="#fff" />
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 12 }}>{`${i + 1}. ${s.label}`}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </LinearGradient>

      <LoadState loading={d.loading && !data} error={d.error} onRetry={reload} />
      {data && (
        <>
          <Grid>
            {[
              <Stat key="p" icon="folder" value={String(live)} label="Active projects" colors={['#3B82F6', '#22D3EE']} />,
              <Stat key="c" icon="target" value={compact(data.period.current.completes)} label="Completes (30d)" trend={trendLabel(data.period.trend.completes)} colors={['#7C3AED', '#C026D3']} />,
              <Stat key="q" icon="pie-chart" value={`${pct(done, target)}%`} label="Live quota done" colors={['#F59E0B', '#F97316']} />,
              <Stat key="cl" icon="users" value={String(data.clients.active)} label="Active clients" colors={['#0EA5E9', '#6366F1']} />,
              <Stat key="r" icon="database" value={conv ? money(conv.current.revenue, conv.currency) : '—'} label="Revenue (30d)" trend={trendLabel(conv?.trend.revenue)} colors={['#EC4899', '#A855F7']} />,
              <Stat key="m" icon="trending-up" value={margin === null ? '—' : `${margin}%`} label="Profit margin" colors={['#10B981', '#22C55E']} />,
            ]}
          </Grid>

          <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
            <Ring value={target ? done / target : 0} size={112} label={`${pct(done, target)}%`} sub="of live target" />
            <View style={{ flex: 1, gap: 6 }}>
              <Text style={{ color: c.text, fontWeight: '800', fontSize: 16 }}>Fieldwork health</Text>
              <Muted>{`${compact(done)} of ${compact(target)} completes across ${data.liveProjects.length} live projects.`}</Muted>
              <Muted>{`Redirects in 24h: ${compact(data.redirectHealth24h.total)}, fallbacks ${compact(data.redirectHealth24h.fallbacks)}.`}</Muted>
            </View>
          </Card>

          {access.allowed.has('projects') && data.liveProjects.length > 0 && (
            <Card>
              <SectionTitle action="All" onAction={() => router.push('/projects')}>
                Live projects
              </SectionTitle>
              <View style={{ gap: 14 }}>
                {data.liveProjects.slice(0, 6).map((p) => (
                  <Pressable key={p.id} accessibilityRole="button" onPress={() => router.push(`/project/${p.id}`)} style={{ gap: 6 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                      <Text style={{ color: c.text, fontWeight: '700', flex: 1 }} numberOfLines={1}>
                        <Text style={{ color: c.primary }}>{p.projectCode}</Text> {p.name}
                      </Text>
                      <Text style={{ color: c.muted, fontSize: 12 }}>{`${p.completes}/${p.target}`}</Text>
                    </View>
                    <Progress value={p.target ? p.completes / p.target : 0} />
                  </Pressable>
                ))}
              </View>
            </Card>
          )}
        </>
      )}

      {access.allowed.has('notifications') && !!ins.data?.items.length && (
        <Card>
          <SectionTitle action="All" onAction={() => router.push('/notifications')}>
            Needs attention
          </SectionTitle>
          {ins.data.items.slice(0, 4).map((i) => (
            <Row key={i.id} title={i.title} subtitle={i.detail} right={<Pill tone={statusTone(i.severity)}>{i.severity === 'bad' ? 'Urgent' : i.severity === 'warn' ? 'Check' : 'Info'}</Pill>} />
          ))}
        </Card>
      )}

      {data && data.top.vendors.length > 0 && (
        <Card>
          <SectionTitle>Supplier performance</SectionTitle>
          <Muted style={{ marginBottom: 10 }}>Completes in the last 30 days, top vendors</Muted>
          <Bars data={data.top.vendors.map((v) => ({ label: v.label.slice(0, 8), value: v.completes }))} format={compact} />
        </Card>
      )}

      {actions.length > 0 && (
        <Card>
          <SectionTitle>Quick actions</SectionTitle>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            {actions.map((a, i) => (
              <Pressable key={a.key} accessibilityRole="button" onPress={a.go} style={{ width: '31%', flexGrow: 1, alignItems: 'center', gap: 8, paddingVertical: 14, borderRadius: 16, backgroundColor: c.card, borderWidth: 1, borderColor: c.border }}>
                <IconTile icon={a.icon} size={38} colors={[c.series[i % 6], c.series[(i + 2) % 6]]} />
                <Text style={{ color: c.text, fontSize: 12, fontWeight: '700' }}>{a.label}</Text>
              </Pressable>
            ))}
          </View>
        </Card>
      )}

      {!!ins.data?.activity?.length && (
        <Card>
          <SectionTitle>Recent activity</SectionTitle>
          {ins.data.activity.slice(0, 5).map((a) => (
            <Row key={a.id} icon="clock" title={`${a.actor}: ${a.action.replace(/[._]/g, ' ')}`} subtitle={`${a.entityType} · ${ago(a.at)}`} />
          ))}
        </Card>
      )}
      {access.plan && <Muted style={{ textAlign: 'center' }}>{`Plan: ${access.plan} · ${FEATURES.filter((f) => access.allowed.has(f.key)).length} features on`}</Muted>}
    </Screen>
  );
}
