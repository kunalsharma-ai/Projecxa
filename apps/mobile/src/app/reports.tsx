import { useState } from 'react';
import { Text, View } from 'react-native';
import { FeatureGate, OpenOnWeb } from '@/components/gate';
import { Bars, Card, Grid, KV, LoadState, Muted, Screen, Segmented, Stat } from '@/components/ui';
import { query } from '@/lib/api';
import { compact, money } from '@/lib/format';
import { useTheme } from '@/lib/theme';
import { useLoad } from '@/lib/use-load';

interface Row { key: string; label: string; sublabel: string | null; clicks: number; completes: number; terminates: number; quotaFull: number; revenue: number; payout: number; profit: number; margin: number | null; conversion: number; currencies: string[]; reporting?: { revenue: number; payout: number; profit: number } }
type Group = 'client' | 'vendor' | 'project' | 'country';
const RANGES = { '7': 'Last 7 days', '30': 'Last 30 days', '90': 'Last 90 days' } as const;
const iso = (d: Date) => d.toISOString().slice(0, 10);

export default function ReportsScreen() {
  return (
    <FeatureGate feature="reports">
      <Reports />
    </FeatureGate>
  );
}

function Reports() {
  const { c } = useTheme();
  const [group, setGroup] = useState<Group>('client');
  const [range, setRange] = useState<keyof typeof RANGES>('30');
  const from = iso(new Date(Date.now() - (Number(range) - 1) * 86_400_000));
  const r = useLoad<{ rows: Row[]; totals: Row | null; fx?: { currency: string } }>(`/reports/summary${query({ groupBy: group, from, to: iso(new Date()) })}`);
  const t = r.data?.totals;
  const base = r.data?.fx?.currency;
  const rows = [...(r.data?.rows ?? [])].sort((a, b) => b.completes - a.completes);
  const cur = (row: Row) => (row.currencies.length === 1 ? row.currencies[0] : null);
  return (
    <Screen title="Reports" subtitle={RANGES[range]} back refreshing={r.refreshing} onRefresh={r.reload}>
      <Segmented value={range} onChange={setRange} options={Object.entries(RANGES).map(([value, l]) => ({ value: value as keyof typeof RANGES, label: l.replace('Last ', '') }))} />
      <Segmented<Group> value={group} onChange={setGroup} options={[{ value: 'client', label: 'Client' }, { value: 'vendor', label: 'Vendor' }, { value: 'project', label: 'Project' }, { value: 'country', label: 'Country' }]} />
      <LoadState loading={r.loading && !r.data} error={r.error} onRetry={r.reload} empty={!!r.data && !rows.length} emptyText="No traffic in this period." />
      {t && (
        <Grid>
          {[
            <Stat key="c" icon="check-circle" value={compact(t.completes)} label="Completes" colors={['#7C3AED', '#C026D3']} />,
            <Stat key="k" icon="mouse-pointer" value={compact(t.clicks)} label="Clicks" colors={['#0EA5E9', '#22D3EE']} />,
            <Stat key="v" icon="percent" value={`${t.conversion}%`} label="Conversion" colors={['#F59E0B', '#F97316']} />,
            <Stat key="r" icon="dollar-sign" value={t.reporting && base ? money(t.reporting.revenue, base) : money(t.revenue, cur(t))} label="Revenue" colors={['#10B981', '#22C55E']} />,
          ]}
        </Grid>
      )}
      {rows.length > 0 && (
        <Card>
          <Text style={{ color: c.text, fontWeight: '800', marginBottom: 8 }}>Completes by {group}</Text>
          <Bars data={rows.slice(0, 6).map((x) => ({ label: x.label.slice(0, 8), value: x.completes }))} format={compact} />
        </Card>
      )}
      {rows.map((x) => (
        <Card key={x.key} style={{ gap: 2 }}>
          <Text style={{ color: c.text, fontWeight: '700' }}>{x.label}</Text>
          {!!x.sublabel && <Muted>{x.sublabel}</Muted>}
          <View style={{ height: 4 }} />
          <KV k="Completes / clicks" v={`${compact(x.completes)} / ${compact(x.clicks)} (${x.conversion}%)`} />
          <KV k="Terminates · over quota" v={`${compact(x.terminates)} · ${compact(x.quotaFull)}`} />
          <KV k="Revenue" v={x.reporting && base ? money(x.reporting.revenue, base) : money(x.revenue, cur(x))} />
          <KV k="Profit" v={`${x.reporting && base ? money(x.reporting.profit, base) : money(x.profit, cur(x))}${x.margin !== null ? ` (${x.margin}%)` : ''}`} />
        </Card>
      ))}
      <OpenOnWeb path="/reports" label="Full reports, PDF and CSV on web" />
    </Screen>
  );
}
