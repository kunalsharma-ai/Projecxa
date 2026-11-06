import { Feather } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ProductLogo } from '@/components/gate';
import { Backdrop, Card, Field, GradientButton, Muted } from '@/components/ui';
import { apiRoot, createApi } from '@/lib/api';
import type { SsoProviderId, SsoProviderInfo } from '@/lib/sso';
import { useSession } from '@/lib/session';
import { useTheme } from '@/lib/theme';

export default function Login() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const s = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [org, setOrg] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'password' | 'mfa'>('password');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showServer, setShowServer] = useState(!s.server);
  const [server, setServer] = useState(s.server);
  const [web, setWeb] = useState(s.webUrl);
  const [providers, setProviders] = useState<SsoProviderInfo[]>([]);
  const [ssoBusy, setSsoBusy] = useState<SsoProviderId | null>(null);

  // The sign-in buttons the server has set up in Settings → Integrations and Single sign-on.
  useEffect(() => {
    const root = apiRoot(server);
    if (!root) return setProviders([]);
    let live = true;
    const t = setTimeout(() => {
      createApi({ baseUrl: root, token: null })
        .get<SsoProviderInfo[]>('/auth/sso/providers')
        .then((p) => live && setProviders(Array.isArray(p) ? p : []))
        .catch(() => live && setProviders([]));
    }, 400);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [server]);

  const sso = async (p: SsoProviderId) => {
    setError(null);
    setSsoBusy(p);
    try {
      if (server !== s.server || web !== s.webUrl) await s.setServer(server, web);
      const r = await s.loginSso(p, org.trim() || undefined);
      if ('mfa' in r) setStep('mfa');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSsoBusy(null);
    }
  };

  const submit = async () => {
    setError(null);
    if (!apiRoot(server)) return setError('Enter your SampTrek server address');
    setBusy(true);
    try {
      if (server !== s.server || web !== s.webUrl) await s.setServer(server, web);
      if (step === 'password') {
        const r = await s.login(email.trim(), password, org.trim() || undefined);
        if ('mfa' in r) setStep('mfa');
      } else {
        await s.loginMfa(code);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Backdrop>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 20, paddingTop: insets.top + 40, gap: 18, flexGrow: 1, justifyContent: 'center' }} keyboardShouldPersistTaps="handled">
          <View style={{ alignItems: 'center', gap: 12 }}>
            <ProductLogo height={72} />
            <Text style={{ color: c.muted, fontSize: 14, textAlign: 'center' }}>Plan · Program · Execute · Monitor · Deliver</Text>
          </View>
          <Card strong style={{ gap: 14 }}>
            {step === 'password' ? (
              <>
                <Field label="Work email" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="username" placeholder="you@company.com" />
                <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" textContentType="password" onSubmitEditing={submit} />
              </>
            ) : (
              <>
                <Muted>Enter the 6-digit code from your authenticator app, or one of your recovery codes.</Muted>
                <Field label="Code" value={code} onChangeText={setCode} autoFocus keyboardType="number-pad" textContentType="oneTimeCode" autoComplete="one-time-code" onSubmitEditing={submit} />
              </>
            )}
            {!!error && (
              <View accessibilityRole="alert" style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
                <Feather name="alert-circle" size={16} color={c.bad} style={{ marginTop: 2 }} />
                <Text style={{ color: c.bad, flex: 1 }}>{error}</Text>
              </View>
            )}
            <GradientButton title={step === 'password' ? 'Sign in' : 'Verify'} icon="log-in" onPress={submit} busy={busy} disabled={step === 'password' ? !email || !password : !code} />
            {step === 'password' && providers.length > 0 && (
              <View style={{ gap: 10 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <View style={{ flex: 1, height: 1, backgroundColor: c.border }} />
                  <Text style={{ color: c.muted, fontSize: 12 }}>or continue with</Text>
                  <View style={{ flex: 1, height: 1, backgroundColor: c.border }} />
                </View>
                {providers.map((p) => (
                  <Pressable
                    key={p.id}
                    accessibilityRole="button"
                    accessibilityLabel={`Sign in with ${p.label}`}
                    disabled={!!ssoBusy || busy}
                    onPress={() => sso(p.id)}
                    style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, minHeight: 48, borderRadius: 14, borderWidth: 1, borderColor: c.border, backgroundColor: c.card, opacity: pressed ? 0.7 : 1 })}
                  >
                    {ssoBusy === p.id ? <ActivityIndicator color={c.primary} /> : <ProviderMark id={p.id} />}
                    <Text style={{ color: c.text, fontWeight: '700', fontSize: 15 }}>Sign in with {p.label}</Text>
                  </Pressable>
                ))}
              </View>
            )}
            {step === 'mfa' && (
              <Pressable onPress={() => setStep('password')} accessibilityRole="button">
                <Text style={{ color: c.primary, textAlign: 'center', fontWeight: '600' }}>Use a different account</Text>
              </Pressable>
            )}
          </Card>

          <Pressable onPress={() => setShowServer((v) => !v)} accessibilityRole="button" style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <Feather name="server" size={14} color={c.muted} />
            <Text style={{ color: c.muted, fontWeight: '600' }}>{showServer ? 'Hide server settings' : 'Server and organisation'}</Text>
          </Pressable>
          {showServer && (
            <Card style={{ gap: 12 }}>
              <Field label="Server address" value={server} onChangeText={setServer} autoCapitalize="none" keyboardType="url" placeholder="https://api.samptrek.yourcompany.com" />
              <Field label="Web app address (optional)" value={web} onChangeText={setWeb} autoCapitalize="none" keyboardType="url" placeholder="https://samptrek.yourcompany.com" />
              <Field label="Organisation (only if asked)" value={org} onChangeText={setOrg} autoCapitalize="none" placeholder="your-org" />
              <Muted>The server address is the SampTrek API your company runs. The web address opens settings screens that live on the web.</Muted>
            </Card>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Backdrop>
  );
}

/** Simple coloured letter marks, so no provider logos are bundled. */
function ProviderMark({ id }: { id: SsoProviderId }) {
  const bg = id === 'google' ? '#4285F4' : id === 'microsoft' ? '#00A4EF' : '#E42527';
  return (
    <View style={{ width: 24, height: 24, borderRadius: 6, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: '#fff', fontWeight: '900', fontSize: 13 }}>{id === 'google' ? 'G' : id === 'microsoft' ? 'M' : 'Z'}</Text>
    </View>
  );
}
