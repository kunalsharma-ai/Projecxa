import { Feather } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useOpenWeb } from '@/components/gate';
import { Card, IconTile, Muted, Screen, SectionTitle } from '@/components/ui';
import { FEATURES, type Feature } from '@/lib/features';
import { useSession } from '@/lib/session';
import { useTheme } from '@/lib/theme';

const GROUPS: Feature['group'][] = ['Workspace', 'Fieldwork', 'Finance', 'People', 'Admin', 'Portal'];

/** Every feature this person has, grouped like the web sidebar. Only what Super Admin switched on is listed. */
export default function More() {
  const { c } = useTheme();
  const { access, me, refreshAccess } = useSession();
  const web = useOpenWeb();
  // Opening this screen re-checks what Super Admin has switched on.
  useFocusEffect(useCallback(() => void refreshAccess(), [refreshAccess]));
  const mine = FEATURES.filter((f) => access.allowed.has(f.key) && (f.route || web.available));
  const open = (f: Feature) => (f.route ? router.push(f.route as never) : f.web && web.open(f.web));
  return (
    <Screen title="All features" subtitle={me?.organization.name} onRefresh={refreshAccess} refreshing={false}>
      <Card onPress={() => router.push('/account')} accessibilityLabel="Account and appearance" style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <IconTile icon="user" size={44} colors={[c.cyan, c.magenta]} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: c.text, fontWeight: '800', fontSize: 16 }}>{me?.user.name}</Text>
          <Muted>{me?.user.email}</Muted>
        </View>
        <Feather name="chevron-right" size={18} color={c.faint} />
      </Card>
      {!mine.length && (
        <Card>
          <Muted>No features are switched on for you in the mobile app yet. Your administrator assigns them in Super Admin; they appear here straight away.</Muted>
        </Card>
      )}
      {GROUPS.map((g) => {
        const items = mine.filter((f) => f.group === g);
        if (!items.length) return null;
        return (
          <View key={g}>
            <SectionTitle>{g}</SectionTitle>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              {items.map((f, i) => (
                <Pressable key={f.key} accessibilityRole="button" accessibilityLabel={f.label} onPress={() => open(f)} style={({ pressed }) => ({ width: '47%', flexGrow: 1, padding: 14, gap: 10, borderRadius: 20, borderWidth: 1, borderColor: c.border, backgroundColor: c.card, opacity: pressed ? 0.75 : 1 })}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <IconTile icon={f.icon} size={38} colors={[c.series[i % 6], c.series[(i + 1) % 6]]} />
                    {!f.route && <Feather name="external-link" size={14} color={c.faint} accessibilityLabel="Opens on web" />}
                  </View>
                  <Text style={{ color: c.text, fontWeight: '700' }}>{f.label}</Text>
                  <Text style={{ color: c.muted, fontSize: 11 }} numberOfLines={2}>
                    {f.hint}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        );
      })}
      <Muted style={{ textAlign: 'center' }}>{access.version ? `Access set by Super Admin${access.plan ? ` · ${access.plan} plan` : ''}` : 'Access follows your role'}</Muted>
    </Screen>
  );
}
