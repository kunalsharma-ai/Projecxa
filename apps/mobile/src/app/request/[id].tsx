import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Switch, Text, View } from 'react-native';
import { FeatureGate } from '@/components/gate';
import { Card, Field, GhostButton, GradientButton, LoadState, Muted, Pill, Screen, statusTone } from '@/components/ui';
import { ago, label } from '@/lib/format';
import { canEdit, useApi, useSession } from '@/lib/session';
import { useTheme } from '@/lib/theme';
import { useLoad } from '@/lib/use-load';
import type { Ticket } from '../requests';

type Msg = { id: string; body: string; internal: boolean; fromPortal: boolean; author: string; createdAt: string };

export default function RequestScreen() {
  return (
    <FeatureGate feature="requests">
      <RequestDetail />
    </FeatureGate>
  );
}

function RequestDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c } = useTheme();
  const api = useApi();
  const { me } = useSession();
  const editor = canEdit(me?.user.role);
  const t = useLoad<Omit<Ticket, 'messages'> & { messages: Msg[] }>(`/requests/${id}`);
  const [body, setBody] = useState('');
  const [internal, setInternal] = useState(false);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      await t.reload();
    } catch (e) {
      Alert.alert('Could not save', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const d = t.data;
  return (
    <Screen title={d?.ref ?? 'Request'} subtitle={d?.subject} back refreshing={t.refreshing} onRefresh={t.reload}>
      <LoadState loading={t.loading && !d} error={t.error} onRetry={t.reload} />
      {d && (
        <>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            <Pill tone={statusTone(d.status)}>{label(d.status)}</Pill>
            <Pill>{label(d.kind)}</Pill>
            {d.project && <Pill tone="primary">{d.project.projectCode}</Pill>}
          </View>
          {d.messages.map((m) => (
            <Card key={m.id} style={{ gap: 6, borderColor: m.internal ? c.warn : c.border, alignSelf: m.fromPortal ? 'flex-start' : 'flex-end', maxWidth: '92%' }}>
              <Muted>{`${m.author}${m.internal ? ' · internal note' : ''} · ${ago(m.createdAt)}`}</Muted>
              <Text style={{ color: c.text, fontSize: 15, lineHeight: 21 }}>{m.body}</Text>
            </Card>
          ))}
          {editor && d.status !== 'CLOSED' && (
            <Card style={{ gap: 10 }}>
              <Field label="Reply" value={body} onChangeText={setBody} multiline style={{ minHeight: 90, textAlignVertical: 'top' }} />
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Switch value={internal} onValueChange={setInternal} accessibilityLabel="Internal note" />
                <Muted>Internal note (client and vendor never see it)</Muted>
              </View>
              <GradientButton title={internal ? 'Add note' : 'Send reply'} icon="send" busy={busy} disabled={!body.trim()} onPress={() => run(async () => { await api.post(`/requests/${id}/messages`, { body: body.trim(), internal }); setBody(''); })} />
              <GhostButton title="Close request" icon="check" onPress={() => run(() => api.patch(`/requests/${id}`, { status: 'CLOSED' }))} />
            </Card>
          )}
          {d.kind === 'DISPUTE' && <Muted>Decide disputes of rejected completes on the web, where you can see each respondent.</Muted>}
        </>
      )}
    </Screen>
  );
}
