import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { UI_LANGUAGES } from '@/i18n';
import { useTheme } from '@/lib/theme';

const wordmarkLight = require('../../assets/wordmark-light.png');
const CREAM = '#F6F3E8';
const SOFT = '#D2E0DC';

function Glyph({
  name,
}: {
  name: 'lock' | 'archive' | 'sparkle' | 'bell' | 'globe' | 'shield' | 'chevron' | 'key';
}) {
  const p = {
    stroke: CREAM,
    strokeWidth: 2,
    fill: 'none',
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  const size = name === 'shield' ? 13 : name === 'chevron' ? 18 : 18;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      {name === 'lock' ? (
        <>
          <Rect x={4} y={11} width={16} height={10} rx={2} {...p} />
          <Path d="M8 11V7a4 4 0 0 1 8 0v4" {...p} />
        </>
      ) : name === 'archive' ? (
        <>
          <Path d="M4 5h16v4H4z" {...p} />
          <Path d="M6 9v10h12V9" {...p} />
          <Path d="M10 13h4" {...p} />
        </>
      ) : name === 'sparkle' ? (
        <Path
          d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7z"
          {...p}
        />
      ) : name === 'bell' ? (
        <>
          <Path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" {...p} />
          <Path d="M10.5 21a1.5 1.5 0 0 0 3 0" {...p} />
        </>
      ) : name === 'globe' ? (
        <>
          <Circle cx={12} cy={12} r={9} {...p} />
          <Path d="M3 12h18" {...p} />
          <Path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18" {...p} />
        </>
      ) : name === 'key' ? (
        <>
          <Circle cx={8} cy={15} r={4} {...p} />
          <Path d="m10.8 12.2 8.2-8.2M16 7l3 3M14 9l2 2" {...p} />
        </>
      ) : name === 'shield' ? (
        <Path d="M12 3l7 3v6c0 4.5-3 7.5-7 9c-4-1.5-7-4.5-7-9V6z" {...p} stroke={SOFT} strokeWidth={2.2} />
      ) : (
        <Path d="M6 9l6 6l6-6" {...p} strokeWidth={2.4} />
      )}
    </Svg>
  );
}

/** First screen: language, three promises, Get started, and help getting a GestIB password. */
export default function Welcome() {
  const { t, i18n } = useTranslation();
  const c = useTheme();
  const [open, setOpen] = useState(false);
  const current = UI_LANGUAGES.find((l) => l.code === i18n.language) ?? UI_LANGUAGES[0];

  const Benefit = ({
    icon,
    title,
    body,
  }: {
    icon: 'lock' | 'sparkle' | 'bell';
    title: string;
    body: string;
  }) => (
    <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
      <View
        style={{
          width: 32,
          height: 32,
          borderRadius: 10,
          backgroundColor: 'rgba(246,243,232,0.12)',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Glyph name={icon} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: CREAM, fontSize: 15, fontWeight: '700', lineHeight: 19 }}>{title}</Text>
        <Text style={{ color: SOFT, fontSize: 13, lineHeight: 17, marginTop: 1 }}>{body}</Text>
      </View>
    </View>
  );

  return (
    <SafeAreaView edges={['top', 'bottom', 'left', 'right']} style={{ flex: 1, backgroundColor: c.accent }}>
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 24, paddingTop: 16, paddingBottom: 12 }}
      >
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Image
            source={wordmarkLight}
            accessibilityLabel="MiCole"
            style={{ width: 168, height: 44 }}
            resizeMode="contain"
          />
          <Text
            accessibilityRole="header"
            style={{
              marginTop: 14,
              color: CREAM,
              fontSize: 21,
              lineHeight: 27,
              fontWeight: '600',
              textAlign: 'center',
              maxWidth: 300,
            }}
          >
            {t('welcome.headline')}
          </Text>

          <View style={{ marginTop: 20, width: '100%' }}>
            <Text
              style={{
                color: SOFT,
                fontSize: 12,
                fontWeight: '700',
                letterSpacing: 1.2,
                textTransform: 'uppercase',
                marginLeft: 4,
                marginBottom: 8,
              }}
            >
              {t('welcome.language')}
            </Text>
            <Pressable
              onPress={() => setOpen(!open)}
              accessibilityRole="button"
              accessibilityState={{ expanded: open }}
              accessibilityLabel={`${t('welcome.language')}: ${current.label}`}
              style={{
                height: 50,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                paddingHorizontal: 16,
                borderRadius: 14,
                borderWidth: 1,
                borderColor: 'rgba(246,243,232,0.28)',
                backgroundColor: 'rgba(246,243,232,0.12)',
              }}
            >
              <Glyph name="globe" />
              <Text style={{ flex: 1, color: CREAM, fontSize: 16, fontWeight: '600' }}>{current.label}</Text>
              <View style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}>
                <Glyph name="chevron" />
              </View>
            </Pressable>
            {open ? (
              <View
                accessibilityRole="list"
                style={{ marginTop: 8, padding: 6, borderRadius: 18, backgroundColor: CREAM }}
              >
                {UI_LANGUAGES.map((l) => {
                  const on = l.code === current.code;
                  return (
                    <Pressable
                      key={l.code}
                      onPress={() => {
                        void i18n.changeLanguage(l.code);
                        setOpen(false);
                      }}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                      style={{
                        height: 46,
                        flexDirection: 'row',
                        alignItems: 'center',
                        paddingHorizontal: 14,
                        borderRadius: 12,
                        backgroundColor: on ? 'rgba(0,84,81,0.10)' : 'transparent',
                      }}
                    >
                      <Text
                        style={{ flex: 1, color: c.accent, fontSize: 17, fontWeight: on ? '700' : '500' }}
                      >
                        {l.label}
                      </Text>
                      {on ? <Text style={{ color: c.accent, fontWeight: '700' }}>✓</Text> : null}
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
            <Text style={{ color: SOFT, fontSize: 13, lineHeight: 17, marginTop: 6, marginLeft: 4 }}>
              {t('welcome.languageCaption')}
            </Text>
          </View>
        </View>

        <View style={{ gap: 12, paddingHorizontal: 2, paddingVertical: 18 }}>
          <Benefit icon="lock" title={t('welcome.b1Title')} body={t('welcome.b1Body')} />
          <Benefit icon="sparkle" title={t('welcome.b2Title')} body={t('welcome.b2Body')} />
          <Benefit icon="bell" title={t('welcome.b3Title')} body={t('welcome.b3Body')} />
        </View>

        <Pressable
          onPress={() => router.push('/sign-in')}
          accessibilityRole="button"
          style={({ pressed }) => ({
            height: 50,
            borderRadius: 14,
            backgroundColor: pressed ? '#FFFFFF' : CREAM,
            alignItems: 'center',
            justifyContent: 'center',
          })}
        >
          <Text style={{ color: c.accent, fontSize: 17, fontWeight: '700' }}>{t('welcome.start')}</Text>
        </Pressable>
        <Pressable
          onPress={() => router.push('/guide')}
          accessibilityRole="link"
          style={{
            minHeight: 44,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            marginTop: 2,
          }}
        >
          <Glyph name="key" />
          <Text style={{ color: CREAM, fontSize: 15, fontWeight: '600', textDecorationLine: 'underline' }}>
            {t('welcome.needPassword')}
          </Text>
        </Pressable>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <Glyph name="shield" />
          <Text style={{ color: SOFT, fontSize: 13 }}>{t('welcome.private')}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
