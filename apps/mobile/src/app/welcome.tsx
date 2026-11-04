import { Wordmark } from '@/components/Clases';
import { Icon } from '@/components/Icon';
import { router, useFocusEffect } from 'expo-router';
import { setStatusBarStyle } from 'expo-status-bar';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { UI_LANGUAGES } from '@/i18n';
import { space, useTheme } from '@/lib/theme';

/** Inverted brand surface: deep teal ground, ivory type, lime action. */
const IVORY = '#FAF7F0';
const ivory = (a: number) => `rgba(250, 247, 240, ${a})`;

export default function Welcome() {
  const { t, i18n } = useTranslation();
  const c = useTheme();

  useFocusEffect(
    useCallback(() => {
      setStatusBarStyle('light');
      return () => setStatusBarStyle('auto');
    }, []),
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.accent }}>
      {/* Soft brand shapes, purely decorative */}
      <View pointerEvents="none" style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
        <View
          style={{
            position: 'absolute',
            top: -140,
            right: -120,
            width: 340,
            height: 340,
            borderRadius: 170,
            backgroundColor: 'rgba(255,255,255,0.05)',
          }}
        />
        <View
          style={{
            position: 'absolute',
            top: 96,
            right: 40,
            width: 14,
            height: 14,
            borderRadius: 7,
            backgroundColor: c.lime,
          }}
        />
      </View>

      <ScrollView
        contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 24, paddingTop: space.xl, paddingBottom: space.l }}
        bounces={false}
      >
        <Wordmark height={34} tint={IVORY} />

        <View style={{ flex: 1, justifyContent: 'center', paddingVertical: 40 }}>
          <Text
            style={{
              color: IVORY,
              fontSize: 36,
              lineHeight: 42,
              fontWeight: '700',
              letterSpacing: -0.8,
            }}
          >
            {t('welcome.tagline')}
          </Text>
          <Text style={{ color: ivory(0.72), fontSize: 17, lineHeight: 24, marginTop: space.m }}>
            {t('welcome.subtitle')}
          </Text>
        </View>

        <Text
          style={{
            color: ivory(0.6),
            fontSize: 12,
            fontWeight: '700',
            letterSpacing: 1.2,
            textTransform: 'uppercase',
            marginBottom: space.s,
          }}
        >
          {t('welcome.language')}
        </Text>
        <View
          style={{
            borderRadius: 18,
            backgroundColor: 'rgba(255,255,255,0.07)',
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.10)',
            overflow: 'hidden',
          }}
        >
          {UI_LANGUAGES.map((l, i) => {
            const active = i18n.language === l.code;
            return (
              <Pressable
                key={l.code}
                onPress={() => void i18n.changeLanguage(l.code)}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  minHeight: 52,
                  paddingHorizontal: space.l,
                  borderTopWidth: i === 0 ? 0 : 1,
                  borderTopColor: 'rgba(255,255,255,0.08)',
                  backgroundColor: active ? 'rgba(255,255,255,0.10)' : pressed ? 'rgba(255,255,255,0.05)' : 'transparent',
                })}
              >
                <Text
                  style={{
                    flex: 1,
                    color: active ? IVORY : ivory(0.82),
                    fontSize: 17,
                    fontWeight: active ? '700' : '500',
                  }}
                >
                  {l.label}
                </Text>
                <View
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 12,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: active ? c.lime : 'transparent',
                    borderWidth: active ? 0 : 1.5,
                    borderColor: ivory(0.35),
                  }}
                >
                  {active ? <Icon name="check" size={14} color={c.ink} strokeWidth={3} /> : null}
                </View>
              </Pressable>
            );
          })}
        </View>

        <Pressable
          onPress={() => router.push('/sign-in')}
          accessibilityRole="button"
          style={({ pressed }) => ({
            marginTop: space.xxl,
            minHeight: 56,
            borderRadius: 16,
            backgroundColor: c.lime,
            opacity: pressed ? 0.88 : 1,
            transform: [{ scale: pressed ? 0.985 : 1 }],
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: space.s,
          })}
        >
          <Text style={{ color: c.ink, fontSize: 17, fontWeight: '700' }}>{t('welcome.continue')}</Text>
          <Icon name="chevron" size={18} color={c.ink} strokeWidth={2.5} />
        </Pressable>

        <Text style={{ color: ivory(0.45), fontSize: 12, textAlign: 'center', marginTop: space.l }}>
          {t('welcome.disclaimer')}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
