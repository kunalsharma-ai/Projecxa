import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import type { ComponentProps, ReactNode } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View, type StyleProp, type TextInputProps, type TextStyle, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, Stop, LinearGradient as SvgGradient } from 'react-native-svg';
import { radius, useTheme, type Palette } from '@/lib/theme';

export type Icon = ComponentProps<typeof Feather>['name'];

/** The glowing gradient behind every screen. */
export function Backdrop({ children }: { children: ReactNode }) {
  const { c } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: c.bg[0] }}>
      <LinearGradient colors={c.bg} style={StyleSheet.absoluteFill} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} />
      <View pointerEvents="none" style={[styles.glow, { backgroundColor: c.glow[0], top: -120, right: -100 }]} />
      <View pointerEvents="none" style={[styles.glow, { backgroundColor: c.glow[1], bottom: -140, left: -120 }]} />
      {children}
    </View>
  );
}

/** Screen with a title bar, optional back button and pull to refresh. */
export function Screen({
  title,
  subtitle,
  back,
  right,
  children,
  refreshing,
  onRefresh,
  scroll = true,
}: {
  title: string;
  subtitle?: string;
  back?: boolean;
  right?: ReactNode;
  children: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  scroll?: boolean;
}) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const header = (
    <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
      {back && (
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/more'))} style={[styles.iconBtn, { backgroundColor: c.card, borderColor: c.border }]}>
          <Feather name="chevron-left" size={20} color={c.text} />
        </Pressable>
      )}
      <View style={{ flex: 1 }}>
        <Text style={[styles.title, { color: c.text }]} numberOfLines={1} accessibilityRole="header">
          {title}
        </Text>
        {!!subtitle && (
          <Text style={{ color: c.muted, fontSize: 13 }} numberOfLines={1}>
            {subtitle}
          </Text>
        )}
      </View>
      {right}
    </View>
  );
  return (
    <Backdrop>
      {header}
      {scroll ? (
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 96, gap: 14 }}
          refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={c.primary} colors={[c.primary]} /> : undefined}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={{ flex: 1 }}>{children}</View>
      )}
    </Backdrop>
  );
}

export function Card({ children, style, strong, onPress, accessibilityLabel }: { children: ReactNode; style?: StyleProp<ViewStyle>; strong?: boolean; onPress?: () => void; accessibilityLabel?: string }) {
  const { c } = useTheme();
  const base = [styles.card, { backgroundColor: strong ? c.cardStrong : c.card, borderColor: c.border }, style];
  if (!onPress) return <View style={base}>{children}</View>;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPress} style={({ pressed }) => [...base, pressed && { opacity: 0.8, transform: [{ scale: 0.99 }] }]}>
      {children}
    </Pressable>
  );
}

export function SectionTitle({ children, action, onAction }: { children: ReactNode; action?: string; onAction?: () => void }) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
      <Text style={{ color: c.text, fontSize: 16, fontWeight: '700' }}>{children}</Text>
      {action && (
        <Pressable accessibilityRole="button" onPress={onAction} hitSlop={8}>
          <Text style={{ color: c.primary, fontWeight: '600', fontSize: 13 }}>{action} →</Text>
        </Pressable>
      )}
    </View>
  );
}

/** Icon in a gradient tile, as in the mockups. */
export function IconTile({ icon, size = 44, colors }: { icon: Icon; size?: number; colors?: [string, string] }) {
  const { c } = useTheme();
  return (
    <LinearGradient colors={colors ?? c.accent} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: size, height: size, borderRadius: size * 0.3, alignItems: 'center', justifyContent: 'center' }}>
      <Feather name={icon} size={size * 0.48} color="#fff" />
    </LinearGradient>
  );
}

export function Stat({ icon, value, label, trend, colors, style }: { icon: Icon; value: string; label: string; trend?: string | null; colors?: [string, string]; style?: StyleProp<ViewStyle> }) {
  const { c } = useTheme();
  const up = trend?.startsWith('+');
  return (
    <Card style={[{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 }, style]}>
      <IconTile icon={icon} size={40} colors={colors} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ color: c.text, fontSize: 20, fontWeight: '800' }} numberOfLines={1} adjustsFontSizeToFit>
          {value}
        </Text>
        <Text style={{ color: c.muted, fontSize: 12 }} numberOfLines={2}>
          {label}
          {trend ? <Text style={{ color: up ? c.good : c.bad, fontWeight: '700' }}>{`  ${up ? '↑' : '↓'} ${trend}`}</Text> : null}
        </Text>
      </View>
    </Card>
  );
}

/** Two stats per row on phones. */
export function Grid({ children, columns = 2 }: { children: ReactNode[]; columns?: number }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
      {children.filter(Boolean).map((ch, i) => (
        <View key={i} style={{ width: `${100 / columns - 2}%`, flexGrow: 1 }}>
          {ch}
        </View>
      ))}
    </View>
  );
}

const TONES = (c: Palette) => ({
  good: c.good,
  warn: c.warn,
  bad: c.bad,
  info: c.info,
  neutral: c.muted,
  primary: c.primary,
});
export type Tone = keyof ReturnType<typeof TONES>;

export const statusTone = (s: string | null | undefined): Tone => {
  switch (s) {
    case 'LIVE': case 'ACTIVE': case 'PAID': case 'DONE': case 'APPROVED': case 'healthy': case 'on_track': case 'ahead': case 'CLOSED_WON':
      return 'good';
    case 'HOLD': case 'PAUSED': case 'warn': case 'watch': case 'behind': case 'IN_PROGRESS': case 'ACKNOWLEDGED': case 'PENDING': case 'SENT': case 'NEW':
      return 'warn';
    case 'bad': case 'failing': case 'stalled': case 'OVERDUE': case 'REJECTED': case 'URGENT': case 'VOID': case 'OPEN_DISPUTE':
      return 'bad';
    case 'TEST': case 'info': case 'OPEN': case 'DRAFT':
      return 'info';
    default:
      return 'neutral';
  }
};

export function Pill({ children, tone = 'neutral' }: { children: ReactNode; tone?: Tone }) {
  const { c } = useTheme();
  const col = TONES(c)[tone];
  return (
    <View style={{ alignSelf: 'flex-start', paddingHorizontal: 9, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: `${col}26`, borderWidth: 1, borderColor: `${col}55` }}>
      <Text style={{ color: col, fontSize: 11, fontWeight: '700', letterSpacing: 0.3 }}>{children}</Text>
    </View>
  );
}

export function Progress({ value, colors, height = 8 }: { value: number; colors?: [string, string]; height?: number }) {
  const { c } = useTheme();
  const v = Math.max(0, Math.min(1, value || 0));
  return (
    <View style={{ height, borderRadius: height, backgroundColor: c.input, overflow: 'hidden' }} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(v * 100) }}>
      <LinearGradient colors={colors ?? [c.cyan, c.primary]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ width: `${v * 100}%`, height: '100%', borderRadius: height }} />
    </View>
  );
}

/** Donut gauge, e.g. "92% health". */
export function Ring({ value, size = 120, stroke = 12, label, sub }: { value: number; size?: number; stroke?: number; label: string; sub?: string }) {
  const { c } = useTheme();
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value || 0));
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }} accessibilityLabel={`${label} ${sub ?? ''}`}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Defs>
          <SvgGradient id="ring" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={c.cyan} />
            <Stop offset="0.5" stopColor={c.primary} />
            <Stop offset="1" stopColor={c.magenta} />
          </SvgGradient>
        </Defs>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={c.input} strokeWidth={stroke} fill="none" />
        <Circle cx={size / 2} cy={size / 2} r={r} stroke="url(#ring)" strokeWidth={stroke} fill="none" strokeDasharray={`${circ * v} ${circ}`} strokeLinecap="round" rotation={-90} originX={size / 2} originY={size / 2} />
      </Svg>
      <Text style={{ color: c.text, fontSize: size * 0.2, fontWeight: '800' }}>{label}</Text>
      {!!sub && <Text style={{ color: c.muted, fontSize: 11 }}>{sub}</Text>}
    </View>
  );
}

/** Simple vertical bars with labels; values are drawn relative to the largest. */
export function Bars({ data, height = 120, format = (n: number) => String(n) }: { data: { label: string; value: number }[]; height?: number; format?: (n: number) => string }) {
  const { c } = useTheme();
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, height: height + 36 }}>
      {data.map((d, i) => (
        <View key={`${d.label}-${i}`} style={{ flex: 1, alignItems: 'center', gap: 4 }}>
          <Text style={{ color: c.text, fontSize: 10, fontWeight: '700' }} numberOfLines={1}>
            {format(d.value)}
          </Text>
          <LinearGradient
            colors={[c.series[i % c.series.length], `${c.series[(i + 1) % c.series.length]}AA`]}
            style={{ width: '100%', maxWidth: 34, height: Math.max(4, (d.value / max) * height), borderRadius: 8 }}
          />
          <Text style={{ color: c.muted, fontSize: 10 }} numberOfLines={1}>
            {d.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

export function GradientButton({ title, onPress, icon, disabled, busy }: { title: string; onPress: () => void; icon?: Icon; disabled?: boolean; busy?: boolean }) {
  const { c } = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: disabled || busy }} disabled={disabled || busy} onPress={onPress} style={({ pressed }) => ({ opacity: disabled ? 0.5 : pressed ? 0.85 : 1 })}>
      <LinearGradient colors={c.accent} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.button}>
        {busy ? <ActivityIndicator color={c.accentText} /> : icon ? <Feather name={icon} size={18} color={c.accentText} /> : null}
        <Text style={{ color: c.accentText, fontWeight: '700', fontSize: 15 }}>{title}</Text>
      </LinearGradient>
    </Pressable>
  );
}

export function GhostButton({ title, onPress, icon, tone, disabled }: { title: string; onPress: () => void; icon?: Icon; tone?: Tone; disabled?: boolean }) {
  const { c } = useTheme();
  const col = tone ? TONES(c)[tone] : c.text;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.ghost, { borderColor: c.border, backgroundColor: c.card, opacity: disabled ? 0.5 : pressed ? 0.7 : 1 }]}
    >
      {icon && <Feather name={icon} size={16} color={col} />}
      <Text style={{ color: col, fontWeight: '600', fontSize: 14 }}>{title}</Text>
    </Pressable>
  );
}

export function Field({ label, ...props }: TextInputProps & { label: string }) {
  const { c } = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: c.muted, fontSize: 13, fontWeight: '600' }}>{label}</Text>
      <TextInput
        placeholderTextColor={c.faint}
        accessibilityLabel={label}
        {...props}
        style={[{ color: c.text, backgroundColor: c.input, borderColor: c.border, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 }, props.style]}
      />
    </View>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  const { c } = useTheme();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable key={o.value} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => onChange(o.value)}>
            {on ? (
              <LinearGradient colors={c.accent} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.seg}>
                <Text style={{ color: c.accentText, fontWeight: '700', fontSize: 13 }}>{o.label}</Text>
              </LinearGradient>
            ) : (
              <View style={[styles.seg, { backgroundColor: c.card, borderColor: c.border, borderWidth: 1 }]}>
                <Text style={{ color: c.muted, fontWeight: '600', fontSize: 13 }}>{o.label}</Text>
              </View>
            )}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export function Row({ title, subtitle, right, onPress, icon }: { title: string; subtitle?: string | null; right?: ReactNode; onPress?: () => void; icon?: Icon }) {
  const { c } = useTheme();
  return (
    <Pressable accessibilityRole={onPress ? 'button' : undefined} disabled={!onPress} onPress={onPress} style={({ pressed }) => [styles.row, { borderColor: c.border, opacity: pressed ? 0.7 : 1 }]}>
      {icon && <Feather name={icon} size={18} color={c.primary} />}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ color: c.text, fontWeight: '600', fontSize: 14 }} numberOfLines={2}>
          {title}
        </Text>
        {!!subtitle && (
          <Text style={{ color: c.muted, fontSize: 12, marginTop: 2 }} numberOfLines={2}>
            {subtitle}
          </Text>
        )}
      </View>
      {right}
      {onPress && <Feather name="chevron-right" size={18} color={c.faint} />}
    </Pressable>
  );
}

export function KV({ k, v }: { k: string; v: ReactNode }) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, gap: 12 }}>
      <Text style={{ color: c.muted, fontSize: 13 }}>{k}</Text>
      {typeof v === 'string' || typeof v === 'number' ? <Text style={{ color: c.text, fontSize: 13, fontWeight: '600', flexShrink: 1, textAlign: 'right' }}>{v}</Text> : v}
    </View>
  );
}

export function Muted({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  const { c } = useTheme();
  return <Text style={[{ color: c.muted, fontSize: 13, lineHeight: 19 }, style]}>{children}</Text>;
}

export function Body({ children, bold }: { children: ReactNode; bold?: boolean }) {
  const { c } = useTheme();
  return <Text style={{ color: c.text, fontSize: 14, lineHeight: 20, fontWeight: bold ? '700' : '400' }}>{children}</Text>;
}

/** Loading, error and empty states in one place. Returns null when there is data to show. */
export function LoadState({ loading, error, empty, onRetry, emptyText = 'Nothing here yet.' }: { loading: boolean; error: string | null; empty?: boolean; onRetry?: () => void; emptyText?: string }) {
  const { c } = useTheme();
  if (loading)
    return (
      <View style={{ padding: 40, alignItems: 'center' }}>
        <ActivityIndicator color={c.primary} size="large" />
      </View>
    );
  if (error)
    return (
      <Card style={{ alignItems: 'center', gap: 10 }}>
        <Feather name="wifi-off" size={22} color={c.bad} />
        <Body>{error}</Body>
        {onRetry && <GhostButton title="Try again" icon="refresh-cw" onPress={onRetry} />}
      </Card>
    );
  if (empty)
    return (
      <Card style={{ alignItems: 'center', gap: 8 }}>
        <Feather name="inbox" size={22} color={c.faint} />
        <Muted>{emptyText}</Muted>
      </Card>
    );
  return null;
}

const styles = StyleSheet.create({
  glow: { position: 'absolute', width: 320, height: 320, borderRadius: 320, opacity: 0.9 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 8 },
  title: { fontSize: 24, fontWeight: '800', letterSpacing: -0.3 },
  iconBtn: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  card: { borderRadius: radius.lg, borderWidth: 1, padding: 16 },
  button: { flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', paddingVertical: 14, paddingHorizontal: 18, borderRadius: radius.md },
  ghost: { flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', paddingVertical: 10, paddingHorizontal: 14, borderRadius: radius.md, borderWidth: 1 },
  seg: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
});
