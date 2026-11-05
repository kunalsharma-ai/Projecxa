import { Feather } from '@expo/vector-icons';
import { Text, View } from 'react-native';
import { BrandMark } from '@/components/gate';
import { Backdrop, Card, GhostButton, GradientButton, Muted } from '@/components/ui';
import { useSession } from '@/lib/session';
import { useTheme } from '@/lib/theme';

const COPY: Record<string, { title: string; body: string }> = {
  MOBILE_DISABLED: { title: 'Mobile app not switched on', body: 'Your administrator has not given you access to the PROJEXA mobile app. You can still use PROJEXA on the web. Ask them to switch the mobile app on for you in Super Admin.' },
  ORG_SUSPENDED: { title: 'Account paused', body: 'Your organisation’s PROJEXA account is paused. Please contact your administrator.' },
  ORG_PENDING: { title: 'Account waiting for approval', body: 'Your organisation’s PROJEXA account has not been approved yet. You can use the app as soon as it is.' },
  SUBSCRIPTION_INACTIVE: { title: 'Subscription inactive', body: 'Your organisation’s subscription is not active, so PROJEXA is not available right now. Please contact your administrator.' },
  NONE: { title: 'Nothing switched on yet', body: 'No features are switched on for you in the mobile app. Ask your administrator to assign features to you in Super Admin.' },
};

export default function Blocked() {
  const { c } = useTheme();
  const { access, refreshAccess, logout, me } = useSession();
  const copy = COPY[access.block ?? 'NONE'];
  return (
    <Backdrop>
      <View style={{ flex: 1, justifyContent: 'center', padding: 20, gap: 18 }}>
        <View style={{ alignItems: 'center' }}>
          <BrandMark size={64} />
        </View>
        <Card strong style={{ gap: 12, alignItems: 'center' }}>
          <Feather name="lock" size={28} color={c.warn} />
          <Text style={{ color: c.text, fontSize: 20, fontWeight: '800', textAlign: 'center' }}>{copy.title}</Text>
          <Muted style={{ alignSelf: 'stretch' }}>{copy.body}</Muted>
          {me && <Muted>{`Signed in as ${me.user.email}`}</Muted>}
          <GradientButton title="Check again" icon="refresh-cw" onPress={refreshAccess} />
          <GhostButton title="Sign out" icon="log-out" onPress={logout} />
        </Card>
      </View>
    </Backdrop>
  );
}
