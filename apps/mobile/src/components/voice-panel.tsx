import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { GhostButton, Muted } from '@/components/ui';
import { useTheme } from '@/lib/theme';
import type { useVoice } from '@/lib/voice';

const STATE_TEXT: Record<string, string> = {
  connecting: 'Connecting…',
  listening: 'Listening',
  recording: 'Recording… tap again to send',
  thinking: 'Thinking…',
  speaking: 'Speaking',
  error: 'Voice stopped',
};

/** The bar above the message box while a voice call or tap to talk is on. */
export function VoicePanel({ voice }: { voice: ReturnType<typeof useVoice> }) {
  const { c } = useTheme();
  const talkMode = voice.mode === 'talk';
  const status = talkMode && voice.state === 'listening' ? 'Tap the microphone and ask' : STATE_TEXT[voice.state] ?? '';
  return (
    <View accessibilityLiveRegion="polite" style={{ marginHorizontal: 12, padding: 14, borderRadius: 18, borderWidth: 1, borderColor: c.border, backgroundColor: c.card, gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        {voice.state === 'connecting' || voice.state === 'thinking' ? <ActivityIndicator color={c.primary} /> : <Feather name={voice.state === 'speaking' ? 'volume-2' : 'mic'} size={18} color={voice.state === 'error' ? c.bad : c.primary} />}
        <Text style={{ color: c.text, fontWeight: '700', flex: 1 }}>{status}</Text>
        <Muted>{voice.mode === 'live' ? 'Live voice' : talkMode ? 'Tap to talk' : ''}</Muted>
      </View>
      {!!voice.heard && <Text style={{ color: c.muted }} numberOfLines={3}>You: {voice.heard}</Text>}
      {!!voice.said && <Text style={{ color: c.text }} numberOfLines={4}>{voice.said}</Text>}
      {!!voice.error && <Text style={{ color: voice.state === 'error' ? c.bad : c.muted }}>{voice.error}</Text>}
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {talkMode && voice.state !== 'thinking' && (
          <Pressable accessibilityRole="button" accessibilityLabel={voice.state === 'recording' ? 'Send question' : 'Start recording'} onPress={voice.talk}>
            <LinearGradient colors={voice.state === 'recording' ? [c.bad, c.bad] : c.accent} style={{ width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' }}>
              <Feather name={voice.state === 'recording' ? 'send' : 'mic'} size={22} color="#fff" />
            </LinearGradient>
          </Pressable>
        )}
        {voice.mode === 'live' && <GhostButton title={voice.muted ? 'Unmute' : 'Mute'} icon={voice.muted ? 'mic' : 'mic-off'} onPress={voice.toggleMute} />}
        {voice.state === 'speaking' && <GhostButton title="Interrupt" icon="skip-forward" onPress={voice.interrupt} />}
        <GhostButton title="End" icon="x" tone="bad" onPress={voice.stop} />
      </View>
    </View>
  );
}
