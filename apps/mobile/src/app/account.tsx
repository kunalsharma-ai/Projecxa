import { Alert, Text, View } from 'react-native';
import { useOpenWeb } from '@/components/gate';
import { PushSettings } from '@/components/push-settings';
import { Card, GhostButton, GradientButton, KV, Muted, Screen, SectionTitle, Segmented } from '@/components/ui';
import { FEATURES } from '@/lib/features';
import { label } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useTheme, type ThemeChoice } from '@/lib/theme';

export default function Account() {
  const { c, choice, setChoice } = useTheme();
  const { me, access, server, logout, refreshAccess } = useSession();
  const web = useOpenWeb();
  if (!me) return null;
  const on = FEATURES.filter((f) => access.allowed.has(f.key));
  return (
    <Screen title="Account" back>
      <Card>
        <Text style={{ color: c.text, fontWeight: '800', fontSize: 18 }}>{me.user.name}</Text>
        <Muted>{me.user.email}</Muted>
        <View style={{ height: 8 }} />
        <KV k="Role" v={label(me.user.role)} />
        <KV k="Organisation" v={me.organization.name} />
        <KV k="Server" v={server.replace(/^https?:\/\//, '')} />
      </Card>
      <Card style={{ gap: 10 }}>
        <SectionTitle>Appearance</SectionTitle>
        <Segmented<ThemeChoice> value={choice} onChange={setChoice} options={[{ value: 'system', label: 'Automatic' }, { value: 'neon', label: 'Neon (dark)' }, { value: 'aurora', label: 'Aurora (light)' }]} />
      </Card>
      <PushSettings />
      <Card style={{ gap: 6 }}>
        <SectionTitle action="Check now" onAction={refreshAccess}>
          Your access
        </SectionTitle>
        <Muted>{access.version ? `Set by Super Admin${access.plan ? ` on the ${access.plan} plan` : ''}. Changes reach this app within seconds.` : 'This server has no Super Admin switches yet, so your role decides.'}</Muted>
        <Muted>{on.length ? on.map((f) => f.label).join(' · ') : 'No features switched on.'}</Muted>
      </Card>
      {web.available && <GhostButton title="Password and two-step sign-in (web)" icon="shield" onPress={() => web.open(me.user.role === 'CLIENT_USER' || me.user.role === 'VENDOR_USER' ? '/portal/account' : '/account/security')} />}
      <GradientButton
        title="Sign out"
        icon="log-out"
        onPress={() =>
          Alert.alert('Sign out?', 'You will need to sign in again, and this phone stops getting notifications.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Sign out', style: 'destructive', onPress: logout },
          ])
        }
      />
    </Screen>
  );
}
