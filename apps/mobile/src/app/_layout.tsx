import { Redirect, Stack, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { BrandMark } from '@/components/gate';
import { PushBridge } from '@/components/push-bridge';
import { SessionProvider, useSession } from '@/lib/session';
import { ThemeProvider, useTheme } from '@/lib/theme';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <SessionProvider>
          <Root />
        </SessionProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

const OPEN = ['login'];

function Root() {
  const { c } = useTheme();
  const { ready, me, access } = useSession();
  const segments = useSegments();
  const first = segments[0] as string | undefined;

  if (!ready)
    return (
      <View style={{ flex: 1, backgroundColor: c.bg[0], alignItems: 'center', justifyContent: 'center', gap: 20 }}>
        <BrandMark size={64} />
        <ActivityIndicator color={c.primary} />
      </View>
    );

  let redirect: string | null = null;
  if (!me && !OPEN.includes(first ?? '')) redirect = '/login';
  else if (me && first === 'login') redirect = '/';
  else if (me && access.block && first !== 'blocked' && first !== 'account') redirect = '/blocked';
  else if (me && !access.block && first === 'blocked') redirect = '/';
  // A deep link to a feature this person cannot use lands on its locked screen (FeatureGate);
  // the tab bar and the More screen never offer it.

  return (
    <>
      <StatusBar style={c.dark ? 'light' : 'dark'} />
      {redirect ? <Redirect href={redirect as never} /> : null}
      {me && !access.block ? <PushBridge /> : null}
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg[0] }, animation: 'slide_from_right' }} />
    </>
  );
}
