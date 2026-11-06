import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import * as Linking from 'expo-linking';
import type { ReactNode } from 'react';
import { Image, Text, View } from 'react-native';
import { FEATURES } from '@/lib/features';
import { useSession } from '@/lib/session';
import { useTheme } from '@/lib/theme';
import { Body, Card, GhostButton, GradientButton, Muted, Screen } from './ui';

/**
 * Wraps a screen that belongs to a feature. When Super Admin switches the feature off, the
 * screen is replaced at once (the switches are re-read on every API answer and every 30s).
 */
export function FeatureGate({ feature, children }: { feature: string; children: ReactNode }) {
  const { access, refreshAccess } = useSession();
  if (access.allowed.has(feature)) return <>{children}</>;
  const f = FEATURES.find((x) => x.key === feature);
  return <Locked title={f?.label ?? 'Not available'} onCheck={refreshAccess} />;
}

export function Locked({ title, onCheck }: { title: string; onCheck: () => void }) {
  const { c } = useTheme();
  return (
    <Screen title={title} back>
      <Card style={{ alignItems: 'center', gap: 12, paddingVertical: 28 }}>
        <LinearGradient colors={c.accent} style={{ width: 56, height: 56, borderRadius: 18, alignItems: 'center', justifyContent: 'center' }}>
          <Feather name="lock" size={26} color="#fff" />
        </LinearGradient>
        <Body bold>Not included in your access</Body>
        <Muted style={{ alignSelf: 'stretch' }}>
          Your administrator has not turned this feature on for you, or your plan does not include it. Ask them to switch it on in Super Admin; it appears here as soon as they do.
        </Muted>
        <GhostButton title="Check again" icon="refresh-cw" onPress={onCheck} />
        <GhostButton title="Go to home" icon="home" onPress={() => router.replace('/')} />
      </Card>
      <Text style={{ color: c.faint, fontSize: 12, textAlign: 'center' }}>Nothing on this screen was loaded.</Text>
    </Screen>
  );
}

/** Opens a page of the SampTrek web app (settings-heavy screens stay on the web). */
export function useOpenWeb() {
  const { webUrl, server } = useSession();
  const base = (webUrl || server.replace(/\/api\/v1\/?$/, '')).replace(/\/+$/, '');
  return {
    available: !!base,
    open: (path: string) => base && Linking.openURL(`${/^https?:\/\//.test(base) ? base : `https://${base}`}${path}`),
  };
}

export function OpenOnWeb({ path, label = 'Open on web' }: { path: string; label?: string }) {
  const web = useOpenWeb();
  if (!web.available) return null;
  return <GradientButton title={label} icon="external-link" onPress={() => web.open(path)} />;
}

/** The "P" mark from the mockups. */
const ICON = require('../../assets/brand/samptrek-icon.png');
const LOGO_FOR_DARK = require('../../assets/brand/samptrek-logo-dark.png');
const LOGO_FOR_LIGHT = require('../../assets/brand/samptrek-logo-light.png');
/** Width ÷ height of the SampTrek logo images. */
const LOGO_RATIO = 717 / 192;

/** SampTrek's icon. */
export function BrandMark({ size = 40 }: { size?: number }) {
  return <Image source={ICON} style={{ width: size, height: size }} resizeMode="contain" accessibilityIgnoresInvertColors />;
}

/** SampTrek's full logo ("Projects on track. by Sampledge"), in the version for the background it sits on. */
export function ProductLogo({ height = 44, onDark }: { height?: number; onDark?: boolean }) {
  const { c } = useTheme();
  const dark = onDark ?? c.dark;
  return <Image source={dark ? LOGO_FOR_DARK : LOGO_FOR_LIGHT} style={{ width: height * LOGO_RATIO, height }} resizeMode="contain" accessibilityLabel="SampTrek. Projects on track. by Sampledge" />;
}

export function Wordmark({ onDark }: { onDark?: boolean }) {
  const { c } = useTheme();
  const { me } = useSession();
  const custom = me?.branding?.custom ? me.branding.appName : null;
  if (!custom) return <ProductLogo height={40} onDark={onDark} />;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <BrandMark size={34} />
      <Text style={{ color: onDark ? '#fff' : c.text, fontWeight: '900', fontSize: 18, letterSpacing: 1 }}>{custom}</Text>
    </View>
  );
}
