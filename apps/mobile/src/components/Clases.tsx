import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Image, Pressable, Text, View, type ViewStyle } from 'react-native';
import { font, space, useTheme } from '@/lib/theme';
import { Icon } from './Icon';

const wordmark = require('../../assets/wordmark.png');

/** The MiCole wordmark (aspect 1481 x 387). */
export function Wordmark({ height = 28, tint }: { height?: number; tint?: string }) {
  return (
    <Image
      source={wordmark}
      accessibilityLabel="MiCole"
      tintColor={tint}
      style={{ height, width: (height * 1481) / 387 }}
      resizeMode="contain"
    />
  );
}

/** Header row: wordmark left; call-the-school and settings right. */
export function AppHeader({ right }: { right?: ReactNode }) {
  const c = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingTop: space.s,
      }}
    >
      <Wordmark />
      <View style={{ flex: 1 }} />
      {right}
      <Pressable
        onPress={() => router.push('/settings')}
        accessibilityRole="button"
        accessibilityLabel="Settings"
        style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22 }}
      >
        <Icon name="gear" color={c.ink} />
      </Pressable>
    </View>
  );
}

/** Search-style entry to Ask, shown on every main screen. */
export function AskBar({ hint }: { hint: string }) {
  const c = useTheme();
  return (
    <Pressable
      onPress={() => router.push('/assistant')}
      accessibilityRole="search"
      accessibilityLabel={hint}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        minHeight: 48,
        paddingHorizontal: space.l,
        backgroundColor: c.card,
        borderWidth: 1,
        borderColor: pressed ? c.accent : c.line,
        borderRadius: 14,
      })}
    >
      <Icon name="search" size={18} color={c.accent} />
      <Text style={{ color: c.muted, fontSize: 15 }}>{hint}</Text>
    </Pressable>
  );
}

export function Dot({ colour, size = 8 }: { colour?: string | null; size?: number }) {
  const c = useTheme();
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colour ?? c.line }} />
  );
}

/** Small uppercase label chip ("MESSAGE", "CIRCULAR"). */
export function Label({ text, tone = 'sage' }: { text: string; tone?: 'sage' | 'plain' }) {
  const c = useTheme();
  return (
    <Text
      style={{
        fontSize: 11,
        fontWeight: '700',
        letterSpacing: 0.6,
        textTransform: 'uppercase',
        color: tone === 'sage' ? c.accent : c.muted,
        backgroundColor: tone === 'sage' ? c.accentSoft : 'transparent',
        paddingHorizontal: tone === 'sage' ? 8 : 0,
        paddingVertical: tone === 'sage' ? 3 : 0,
        borderRadius: 6,
        overflow: 'hidden',
      }}
    >
      {text}
    </Text>
  );
}

export function BackLink({ label, style }: { label: string; style?: ViewStyle }) {
  const c = useTheme();
  return (
    <Pressable
      onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
      accessibilityRole="link"
      style={[
        { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 44, alignSelf: 'flex-start' },
        style,
      ]}
    >
      <Icon name="back" size={18} color={c.accent} />
      <Text style={{ color: c.accent, fontSize: font.body, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}
