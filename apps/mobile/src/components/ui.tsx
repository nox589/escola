import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { font, radius, space, useTheme } from '@/lib/theme';

export function Screen({
  children,
  scroll = true,
  padded = true,
}: {
  children: ReactNode;
  scroll?: boolean;
  padded?: boolean;
}) {
  const c = useTheme();
  const inner = <View style={{ padding: padded ? space.l : 0, gap: space.l, flexGrow: 1 }}>{children}</View>;
  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={{ flex: 1, backgroundColor: c.bg }}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, paddingBottom: space.xxl }}
          keyboardShouldPersistTaps="handled"
        >
          {inner}
        </ScrollView>
      ) : (
        inner
      )}
    </SafeAreaView>
  );
}

export function H1({ children }: { children: ReactNode }) {
  const c = useTheme();
  return (
    <Text
      accessibilityRole="header"
      style={{ fontSize: font.title, fontWeight: '700', color: c.ink, letterSpacing: -0.3 }}
    >
      {children}
    </Text>
  );
}

export function H2({ children }: { children: ReactNode }) {
  const c = useTheme();
  return (
    <Text accessibilityRole="header" style={{ fontSize: font.h2, fontWeight: '600', color: c.ink }}>
      {children}
    </Text>
  );
}

export function P({
  children,
  muted,
  small,
  style,
}: {
  children: ReactNode;
  muted?: boolean;
  small?: boolean;
  style?: object;
}) {
  const c = useTheme();
  return (
    <Text
      style={[
        {
          fontSize: small ? font.small : font.body,
          color: muted ? c.muted : c.ink,
          lineHeight: (small ? font.small : font.body) * 1.45,
        },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

export function Card({
  children,
  onPress,
  style,
  accent,
}: {
  children: ReactNode;
  onPress?: () => void;
  style?: ViewStyle;
  accent?: string;
}) {
  const c = useTheme();
  const base: ViewStyle = {
    backgroundColor: c.card,
    borderRadius: radius.m,
    padding: space.l,
    gap: space.s,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.line,
    ...(accent ? { borderLeftWidth: 4, borderLeftColor: accent } : {}),
    ...style,
  };
  if (!onPress) return <View style={base}>{children}</View>;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [base, pressed && { opacity: 0.85 }]}
    >
      {children}
    </Pressable>
  );
}

export function Button({
  title,
  onPress,
  kind = 'primary',
  loading,
  disabled,
}: {
  title: string;
  onPress: () => void;
  kind?: 'primary' | 'secondary' | 'danger' | 'ghost';
  loading?: boolean;
  disabled?: boolean;
}) {
  const c = useTheme();
  const bg = { primary: c.accent, secondary: c.accentSoft, danger: c.dangerSoft, ghost: 'transparent' }[kind];
  const fg = { primary: '#fff', secondary: c.accent, danger: c.danger, ghost: c.accent }[kind];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || loading }}
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => ({
        backgroundColor: bg,
        borderRadius: radius.m,
        paddingVertical: 14,
        paddingHorizontal: space.l,
        alignItems: 'center',
        opacity: disabled ? 0.45 : pressed ? 0.85 : 1,
      })}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text style={{ color: fg, fontSize: font.body, fontWeight: '600' }}>{title}</Text>
      )}
    </Pressable>
  );
}

export function Field({ label, ...props }: TextInputProps & { label: string }) {
  const c = useTheme();
  return (
    <View style={{ gap: space.xs }}>
      <Text style={{ color: c.muted, fontSize: font.small, fontWeight: '500' }}>{label}</Text>
      <TextInput
        placeholderTextColor={c.muted}
        accessibilityLabel={label}
        {...props}
        style={[
          {
            borderWidth: 1,
            borderColor: c.line,
            borderRadius: radius.s,
            paddingHorizontal: space.m,
            paddingVertical: 12,
            fontSize: font.body,
            color: c.ink,
            backgroundColor: c.card,
          },
          props.multiline && { minHeight: 120, textAlignVertical: 'top' },
        ]}
      />
    </View>
  );
}

export function Chip({
  label,
  active,
  onPress,
  colour,
}: {
  label: string;
  active?: boolean;
  onPress: () => void;
  colour?: string | null;
}) {
  const c = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!active }}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: space.m,
        paddingVertical: 7,
        borderRadius: 999,
        backgroundColor: active ? c.ink : c.card,
        borderWidth: 1,
        borderColor: active ? c.ink : c.line,
      }}
    >
      {colour ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colour }} /> : null}
      <Text style={{ color: active ? c.bg : c.ink, fontSize: font.small, fontWeight: '500' }}>{label}</Text>
    </Pressable>
  );
}

export function Badge({
  label,
  tone = 'neutral',
}: {
  label: string;
  tone?: 'neutral' | 'warn' | 'danger' | 'ok';
}) {
  const c = useTheme();
  const [bg, fg] = {
    neutral: [c.line, c.ink],
    warn: [c.warnSoft, c.warn],
    danger: [c.dangerSoft, c.danger],
    ok: [c.accentSoft, c.accent],
  }[tone];
  return (
    <View
      style={{
        alignSelf: 'flex-start',
        backgroundColor: bg,
        borderRadius: 6,
        paddingHorizontal: 8,
        paddingVertical: 3,
      }}
    >
      <Text style={{ color: fg, fontSize: font.tiny, fontWeight: '600' }}>{label}</Text>
    </View>
  );
}

export function Banner({
  text,
  tone = 'warn',
  action,
}: {
  text: string;
  tone?: 'warn' | 'danger' | 'ok';
  action?: { label: string; onPress: () => void };
}) {
  const c = useTheme();
  const [bg, fg] = {
    warn: [c.warnSoft, c.warn],
    danger: [c.dangerSoft, c.danger],
    ok: [c.accentSoft, c.accent],
  }[tone];
  return (
    <View
      style={{
        backgroundColor: bg,
        borderRadius: radius.m,
        padding: space.m,
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.m,
      }}
    >
      <Text style={{ color: fg, flex: 1, fontSize: font.small, fontWeight: '500' }}>{text}</Text>
      {action ? (
        <Pressable onPress={action.onPress} accessibilityRole="button">
          <Text style={{ color: fg, fontWeight: '700', fontSize: font.small }}>{action.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function Loading() {
  const c = useTheme();
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        padding: space.xxl,
        backgroundColor: c.bg,
      }}
    >
      <ActivityIndicator color={c.accent} />
    </View>
  );
}

export function Row({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap: space.s }, style]}>{children}</View>
  );
}

export function Divider() {
  const c = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.line }} />;
}
