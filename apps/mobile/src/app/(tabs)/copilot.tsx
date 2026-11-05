import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View, type ScrollViewInstance } from 'react-native';
import { FeatureGate } from '@/components/gate';
import { Bars, Card, GhostButton, IconTile, KV, Muted, Pill, Screen } from '@/components/ui';
import { useApi } from '@/lib/session';
import { useTheme } from '@/lib/theme';

type Display =
  | { type: 'table'; title: string; columns: { key: string; label: string }[]; rows: Record<string, string | number | boolean | null>[] }
  | { type: 'bars'; title: string; unit?: string; items: { label: string; value: number }[] }
  | { type: 'stats'; title: string; items: { label: string; value: string }[] };
interface Action { id: string; tool: string; summary: string; status: string; error: string | null }
interface Message { id: string; role: 'user' | 'assistant'; text: string; displays?: Display[]; actions?: Action[] }

const STARTERS = ['Which live projects are behind pace?', 'Summarise fieldwork health today', 'Top 5 vendors by completes this month', 'What invoices are overdue?'];

export default function CopilotScreen() {
  return (
    <FeatureGate feature="copilot">
      <Copilot />
    </FeatureGate>
  );
}

function Copilot() {
  const { c } = useTheme();
  const api = useApi();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scroller = useRef<ScrollViewInstance>(null);

  const send = async (msg = text) => {
    const m = msg.trim();
    if (!m || busy) return;
    setText('');
    setError(null);
    setBusy(true);
    setMessages((x) => [...x, { id: `local-${Date.now()}`, role: 'user', text: m }]);
    try {
      const r = await api.post<{ conversationId: string; messages: Message[] }>('/ai/chat', { conversationId, message: m, path: '/mobile' });
      setConversationId(r.conversationId);
      setMessages((x) => [...x.filter((y) => !y.id.startsWith('local-')), ...r.messages]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setTimeout(() => scroller.current?.scrollToEnd({ animated: true }), 50);
    }
  };

  const decide = async (a: Action, what: 'confirm' | 'cancel') => {
    try {
      const r = await api.post<Action>(`/ai/actions/${a.id}/${what}`);
      setMessages((x) => x.map((m) => ({ ...m, actions: m.actions?.map((y) => (y.id === a.id ? { ...y, ...r } : y)) })));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Screen
      title="AI copilot"
      subtitle="Ask about projects, pace, money and vendors"
      scroll={false}
      right={messages.length ? <GhostButton title="New" icon="plus" onPress={() => { setMessages([]); setConversationId(null); }} /> : undefined}
    >
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }} keyboardVerticalOffset={80}>
        <ScrollView ref={scroller} contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 24 }}>
          {!messages.length && (
            <Card style={{ alignItems: 'center', gap: 12 }}>
              <IconTile icon="cpu" size={56} />
              <Text style={{ color: c.text, fontSize: 18, fontWeight: '800' }}>How can I help you today?</Text>
              <Muted style={{ alignSelf: 'stretch' }}>Answers use your live PROJEXA data. Anything that changes data shows a card for you to confirm first.</Muted>
              <View style={{ alignSelf: 'stretch', gap: 8 }}>
                {STARTERS.map((s) => (
                  <Pressable key={s} accessibilityRole="button" onPress={() => send(s)} style={{ flexDirection: 'row', gap: 8, alignItems: 'center', padding: 12, borderRadius: 14, borderWidth: 1, borderColor: c.border, backgroundColor: c.card }}>
                    <Feather name="check" size={14} color={c.primary} />
                    <Text style={{ color: c.text, fontWeight: '600', flex: 1 }}>{s}</Text>
                  </Pressable>
                ))}
              </View>
            </Card>
          )}
          {messages.map((m) =>
            m.role === 'user' ? (
              <LinearGradient key={m.id} colors={c.accent} style={{ alignSelf: 'flex-end', maxWidth: '85%', borderRadius: 18, borderBottomRightRadius: 4, padding: 12 }}>
                <Text style={{ color: '#fff', fontSize: 15 }}>{m.text}</Text>
              </LinearGradient>
            ) : (
              <Card key={m.id} style={{ alignSelf: 'stretch', gap: 10, borderBottomLeftRadius: 4 }}>
                {!!m.text && <Text style={{ color: c.text, fontSize: 15, lineHeight: 21 }}>{m.text}</Text>}
                {m.displays?.map((d, i) => <DisplayBlock key={i} d={d} />)}
                {m.actions?.map((a) => (
                  <View key={a.id} style={{ borderWidth: 1, borderColor: c.border, borderRadius: 14, padding: 12, gap: 8 }}>
                    <Text style={{ color: c.text, fontWeight: '700' }}>{a.summary}</Text>
                    {a.status === 'pending' ? (
                      <View style={{ flexDirection: 'row', gap: 8 }}>
                        <GhostButton title="Confirm" icon="check" tone="good" onPress={() => decide(a, 'confirm')} />
                        <GhostButton title="Cancel" icon="x" onPress={() => decide(a, 'cancel')} />
                      </View>
                    ) : (
                      <Pill tone={a.status === 'done' ? 'good' : a.status === 'failed' ? 'bad' : 'neutral'}>{a.status.charAt(0).toUpperCase() + a.status.slice(1)}</Pill>
                    )}
                    {!!a.error && <Text style={{ color: c.bad }}>{a.error}</Text>}
                  </View>
                ))}
              </Card>
            ),
          )}
          {busy && <ActivityIndicator color={c.primary} />}
          {!!error && <Text style={{ color: c.bad }}>{error}</Text>}
        </ScrollView>
        <View style={{ flexDirection: 'row', gap: 8, padding: 12, paddingBottom: 96, alignItems: 'flex-end' }}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Ask me anything…"
            placeholderTextColor={c.faint}
            accessibilityLabel="Message to copilot"
            multiline
            style={{ flex: 1, color: c.text, backgroundColor: c.input, borderColor: c.border, borderWidth: 1, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 11, maxHeight: 120, fontSize: 15 }}
          />
          <Pressable accessibilityRole="button" accessibilityLabel="Send" onPress={() => send()} disabled={busy || !text.trim()}>
            <LinearGradient colors={c.accent} style={{ width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', opacity: busy || !text.trim() ? 0.5 : 1 }}>
              <Feather name="send" size={18} color="#fff" />
            </LinearGradient>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

function DisplayBlock({ d }: { d: Display }) {
  const { c } = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: c.muted, fontWeight: '700', fontSize: 12, textTransform: 'uppercase' }}>{d.title}</Text>
      {d.type === 'stats' && d.items.map((i) => <KV key={i.label} k={i.label} v={i.value} />)}
      {d.type === 'bars' && <Bars data={d.items.slice(0, 6).map((i) => ({ label: i.label.slice(0, 8), value: i.value }))} height={90} />}
      {d.type === 'table' &&
        d.rows.slice(0, 8).map((r, i) => (
          <View key={i} style={{ borderTopWidth: i ? 1 : 0, borderTopColor: c.border, paddingTop: i ? 6 : 0 }}>
            {d.columns.slice(0, 4).map((col) => (
              <KV key={col.key} k={col.label} v={r[col.key] === null || r[col.key] === undefined ? '—' : String(r[col.key])} />
            ))}
          </View>
        ))}
    </View>
  );
}
