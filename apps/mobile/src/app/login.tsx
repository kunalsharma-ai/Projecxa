import { Feather } from '@expo/vector-icons';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BrandMark } from '@/components/gate';
import { Backdrop, Card, Field, GradientButton, Muted } from '@/components/ui';
import { apiRoot } from '@/lib/api';
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

  const submit = async () => {
    setError(null);
    if (!apiRoot(server)) return setError('Enter your PROJEXA server address');
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
            <BrandMark size={72} />
            <Text style={{ color: c.text, fontSize: 30, fontWeight: '900', letterSpacing: 2 }}>PROJEXA</Text>
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
              <Field label="Server address" value={server} onChangeText={setServer} autoCapitalize="none" keyboardType="url" placeholder="https://api.projexa.yourcompany.com" />
              <Field label="Web app address (optional)" value={web} onChangeText={setWeb} autoCapitalize="none" keyboardType="url" placeholder="https://projexa.yourcompany.com" />
              <Field label="Organisation (only if asked)" value={org} onChangeText={setOrg} autoCapitalize="none" placeholder="your-org" />
              <Muted>The server address is the PROJEXA API your company runs. The web address opens settings screens that live on the web.</Muted>
            </Card>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Backdrop>
  );
}
