import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Switch, Text, View } from 'react-native';
import { Card, GhostButton, Muted, SectionTitle } from '@/components/ui';
import { getPushToken, PUSH_OFF_KEY, registerDevice, unregisterDevice, type PushDevice } from '@/lib/push';
import { useSession } from '@/lib/session';
import { storage } from '@/lib/storage';
import { useTheme } from '@/lib/theme';

/** Account → Push notifications: on/off for this phone, what to be told about, and a test push. */
export function PushSettings() {
  const { c } = useTheme();
  const { api, me } = useSession();
  const [device, setDevice] = useState<PushDevice | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [off, setOff] = useState(false);
  const [busy, setBusy] = useState(true);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setNote(null);
    try {
      if ((await storage.get(PUSH_OFF_KEY)) === me?.user.id) {
        setOff(true);
        setDevice(null);
        return;
      }
      setOff(false);
      const t = await getPushToken();
      if ('error' in t) return setNote(t.error);
      setToken(t.token);
      setDevice(await registerDevice(api, t.token));
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [api, me?.user.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const setAll = async (on: boolean) => {
    if (!me) return;
    setBusy(true);
    if (on) {
      await storage.set(PUSH_OFF_KEY, null);
      await load();
    } else {
      await unregisterDevice(api);
      await storage.set(PUSH_OFF_KEY, me.user.id);
      setOff(true);
      setDevice(null);
      setBusy(false);
    }
  };

  const toggle = async (key: string, on: boolean) => {
    if (!device || !token) return;
    const categories = on ? [...new Set([...device.categories, key])] : device.categories.filter((k) => k !== key);
    setDevice({ ...device, categories });
    try {
      setDevice(await registerDevice(api, token, categories));
    } catch (e) {
      setNote((e as Error).message);
    }
  };

  const test = async () => {
    if (!token) return;
    setNote(null);
    try {
      await api.post('/push/test', { token });
      setNote('Test sent. It should arrive in a few seconds.');
    } catch (e) {
      setNote((e as Error).message);
    }
  };

  if (Platform.OS === 'web') return null;
  return (
    <Card style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <SectionTitle>Push notifications</SectionTitle>
        {busy ? <ActivityIndicator color={c.primary} /> : <Switch accessibilityLabel="Push notifications on this phone" value={!off && !!device} onValueChange={setAll} />}
      </View>
      {device && !device.enabled && <Muted>Your admin has not turned push on yet (web: Settings → Integrations → Push notifications).</Muted>}
      {device?.available.map((cat) => (
        <View key={cat.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.text, fontWeight: '600' }}>{cat.label}</Text>
            <Muted>{cat.hint}</Muted>
          </View>
          <Switch accessibilityLabel={cat.label} value={device.categories.includes(cat.key)} onValueChange={(v) => toggle(cat.key, v)} />
        </View>
      ))}
      {off && <Muted>Off on this phone. Turn it on to hear about alerts, requests and reminders.</Muted>}
      {!!note && <Text style={{ color: c.muted }}>{note}</Text>}
      {device?.enabled && <GhostButton title="Send a test notification" icon="bell" onPress={test} />}
    </Card>
  );
}
