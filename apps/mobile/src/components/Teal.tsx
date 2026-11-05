import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, Text, TextInput, View, type TextInputProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { useTheme } from '@/lib/theme';

/** The teal look of the welcome screen, shared by the screens before sign-in. */
export const CREAM = '#F6F3E8';
export const SOFT = '#D2E0DC';
const wordmarkLight = require('../../assets/wordmark-light.png');

export function TealScreen({ children, back }: { children: ReactNode; back?: string }) {
  const c = useTheme();
  return (
    <SafeAreaView edges={['top', 'bottom', 'left', 'right']} style={{ flex: 1, backgroundColor: c.accent }}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 28, paddingTop: 12, paddingBottom: 24, gap: 18 }}>
        {back ? (
          <Pressable
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/welcome'))}
            accessibilityRole="link"
            style={{ flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 44, alignSelf: 'flex-start' }}
          >
            <Svg width={18} height={18} viewBox="0 0 24 24" aria-hidden>
              <Path d="M15 18l-6-6 6-6" stroke={CREAM} strokeWidth={2.2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
            <Text style={{ color: CREAM, fontSize: 16, fontWeight: '600' }}>{back}</Text>
          </Pressable>
        ) : null}
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export function TealWordmark({ height = 40 }: { height?: number }) {
  return <Image source={wordmarkLight} accessibilityLabel="clases" style={{ height, width: (height * 1442) / 381 }} resizeMode="contain" />;
}

export function TealTitle({ children, lead }: { children: string; lead?: string }) {
  return (
    <View style={{ gap: 6 }}>
      <Text accessibilityRole="header" style={{ color: CREAM, fontSize: 28, lineHeight: 34, fontWeight: '700' }}>{children}</Text>
      {lead ? <Text style={{ color: SOFT, fontSize: 16, lineHeight: 22 }}>{lead}</Text> : null}
    </View>
  );
}

export function TealField({ label, ...props }: TextInputProps & { label: string }) {
  const c = useTheme();
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: SOFT, fontSize: 12, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase', marginLeft: 4 }}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor="#7E9A95"
        {...props}
        style={{ height: 56, borderRadius: 16, backgroundColor: CREAM, paddingHorizontal: 18, fontSize: 17, color: c.accent, fontWeight: '600' }}
      />
    </View>
  );
}

export function TealButton({ title, onPress, disabled, loading, kind = 'solid' }: { title: string; onPress: () => void; disabled?: boolean; loading?: boolean; kind?: 'solid' | 'outline' }) {
  const c = useTheme();
  const solid = kind === 'solid';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!(disabled || loading) }}
      style={({ pressed }) => ({
        height: 56,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: solid ? (pressed ? '#FFFFFF' : CREAM) : 'transparent',
        borderWidth: solid ? 0 : 1.5,
        borderColor: CREAM,
        opacity: disabled ? 0.45 : 1,
      })}
    >
      {loading ? <ActivityIndicator color={solid ? c.accent : CREAM} /> : <Text style={{ color: solid ? c.accent : CREAM, fontSize: 17, fontWeight: '700' }}>{title}</Text>}
    </Pressable>
  );
}

export function TealNote({ text, tone = 'info' }: { text: string; tone?: 'info' | 'ok' | 'danger' }) {
  return (
    <View
      accessibilityRole="alert"
      style={{
        borderRadius: 14,
        padding: 14,
        backgroundColor: tone === 'danger' ? '#F6DCD5' : 'rgba(246,243,232,0.14)',
        borderWidth: 1,
        borderColor: tone === 'ok' ? '#C0CF58' : tone === 'danger' ? '#F6DCD5' : 'rgba(246,243,232,0.28)',
      }}
    >
      <Text style={{ color: tone === 'danger' ? '#8A2E1F' : CREAM, fontSize: 15, lineHeight: 21 }}>{text}</Text>
    </View>
  );
}

export function TealFooter({ text }: { text: string }) {
  return <Text style={{ color: SOFT, fontSize: 13, textAlign: 'center' }}>{text}</Text>;
}
