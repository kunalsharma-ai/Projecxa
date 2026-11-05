import { Text, View } from 'react-native';
import { FeatureGate, OpenOnWeb } from '@/components/gate';
import { Card, Grid, KV, LoadState, Muted, Screen, Stat } from '@/components/ui';
import { amounts, money } from '@/lib/format';
import { useTheme } from '@/lib/theme';
import { useLoad } from '@/lib/use-load';

type Amount = { currency: string; amount: number };
type Bucket = { completes: number; amount: number };
type Total = { completes: number; byCurrency: Amount[]; base: { currency: string; amount: number; missing: string[] } };
interface Summary {
  vendors: { vendor: { id: string; name: string }; currency: string; pending: Bucket; unbilled: Bucket; draft: Bucket; due: Bucket; paid: Bucket }[];
  totals: Record<'unbilled' | 'draft' | 'due' | 'paid' | 'pending', Total>;
}

export default function PayablesScreen() {
  return (
    <FeatureGate feature="payables">
      <Payables />
    </FeatureGate>
  );
}

function Payables() {
  const { c } = useTheme();
  const s = useLoad<Summary>('/payables/summary');
  const t = s.data?.totals;
  const show = (x: Total) => (x.base.missing.length ? amounts(x.byCurrency) : money(x.base.amount, x.base.currency));
  return (
    <Screen title="Vendor payables" subtitle="What you owe vendors" back refreshing={s.refreshing} onRefresh={s.reload}>
      <LoadState loading={s.loading && !s.data} error={s.error} onRetry={s.reload} empty={!!s.data && !s.data.vendors.length} emptyText="Nothing owed to vendors." />
      {t && (
        <Grid>
          {[
            <Stat key="d" icon="alert-circle" value={show(t.due)} label="Billed, due" colors={['#F43F5E', '#F97316']} />,
            <Stat key="u" icon="inbox" value={show(t.unbilled)} label="Approved, not billed" colors={['#F59E0B', '#EAB308']} />,
            <Stat key="p" icon="clock" value={show(t.pending)} label="Waiting for approval" colors={['#6366F1', '#A855F7']} />,
            <Stat key="ok" icon="check-circle" value={show(t.paid)} label="Paid" colors={['#10B981', '#22C55E']} />,
          ]}
        </Grid>
      )}
      {s.data?.vendors.map((v) => (
        <Card key={`${v.vendor.id}-${v.currency}`} style={{ gap: 2 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ color: c.text, fontWeight: '700' }}>{v.vendor.name}</Text>
            <Muted>{v.currency}</Muted>
          </View>
          <KV k="Due" v={money(v.due.amount, v.currency)} />
          <KV k="Not billed" v={`${money(v.unbilled.amount, v.currency)} · ${v.unbilled.completes} completes`} />
          <KV k="Paid" v={money(v.paid.amount, v.currency)} />
        </Card>
      ))}
      <OpenOnWeb path="/payables" label="Create bills and record payments on web" />
    </Screen>
  );
}
