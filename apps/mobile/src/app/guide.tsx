import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, TextInput, View } from 'react-native';
import { BackLink } from '@/components/Clases';
import { Icon } from '@/components/Icon';
import { Screen } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { gestibUsername, guideFor, type GuideSection } from '@/lib/guide';
import { font, space, useTheme } from '@/lib/theme';

const GESTIB_HOME = 'https://www3.caib.es/xestib';

/** Parent guide (before sign-in and from the GestIB connect screen): account, username, reset, rules, help. */
export default function Guide() {
  const { i18n } = useTranslation();
  const c = useTheme();
  const g = guideFor(i18n.language);
  const signedIn = !!useAuth((s) => s.tokens);
  const [open, setOpen] = useState<GuideSection['id'] | null>(null);
  const [id, setId] = useState('');
  const username = gestibUsername(id);

  return (
    <Screen>
      <BackLink label={g.back} />
      <View style={{ gap: 6 }}>
        <Text accessibilityRole="header" style={{ color: c.ink, fontSize: font.title, fontWeight: '700' }}>
          {g.title}
        </Text>
        <Text style={{ color: c.mutedOnBg, fontSize: 15, lineHeight: 21 }}>{g.intro}</Text>
      </View>

      <View style={{ gap: 10 }}>
        {g.sections.map((s) => {
          const isOpen = open === s.id;
          return (
            <View
              key={s.id}
              style={{
                backgroundColor: c.card,
                borderWidth: 1,
                borderColor: isOpen ? c.accent : c.line,
                borderRadius: 16,
                overflow: 'hidden',
              }}
            >
              <Pressable
                onPress={() => setOpen(isOpen ? null : s.id)}
                accessibilityRole="button"
                accessibilityState={{ expanded: isOpen }}
                style={{
                  minHeight: 56,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                  paddingHorizontal: space.l,
                }}
              >
                <Text style={{ flex: 1, color: c.ink, fontSize: 16, fontWeight: '700' }}>{s.title}</Text>
                <View style={{ transform: [{ rotate: isOpen ? '90deg' : '0deg' }] }}>
                  <Icon name="chevron" size={18} color={c.accent} />
                </View>
              </Pressable>
              {isOpen ? (
                <View style={{ paddingHorizontal: space.l, paddingBottom: space.l, gap: 10 }}>
                  {s.intro ? (
                    <Text style={{ color: c.ink, fontSize: 15, lineHeight: 21 }}>{s.intro}</Text>
                  ) : null}
                  {s.steps?.map((step, i) => (
                    <View key={i} style={{ flexDirection: 'row', gap: 10 }}>
                      <View
                        style={{
                          width: 26,
                          height: 26,
                          borderRadius: 13,
                          backgroundColor: c.accent,
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <Text style={{ color: '#FFFFFF', fontSize: 13, fontWeight: '700' }}>{i + 1}</Text>
                      </View>
                      <Text style={{ flex: 1, color: c.ink, fontSize: 15, lineHeight: 21 }}>{step}</Text>
                    </View>
                  ))}
                  {s.bullets?.map((b, i) => (
                    <View key={i} style={{ flexDirection: 'row', gap: 10 }}>
                      <Text style={{ color: c.accent, fontSize: 15, lineHeight: 21 }}>•</Text>
                      <Text style={{ flex: 1, color: c.ink, fontSize: 15, lineHeight: 21 }}>{b}</Text>
                    </View>
                  ))}
                  {s.id === 'username' ? (
                    <View style={{ gap: 8 }}>
                      <Text style={{ color: c.mutedOnBg, fontSize: 13, fontWeight: '600' }}>
                        {g.usernameLabel}
                      </Text>
                      <TextInput
                        value={id}
                        onChangeText={setId}
                        placeholder={g.usernamePlaceholder}
                        placeholderTextColor={c.muted}
                        accessibilityLabel={g.usernameLabel}
                        autoCapitalize="characters"
                        autoCorrect={false}
                        autoComplete="off"
                        style={{
                          minHeight: 48,
                          borderWidth: 1,
                          borderColor: c.line,
                          borderRadius: 12,
                          paddingHorizontal: 14,
                          fontSize: 17,
                          color: c.ink,
                          backgroundColor: c.bg,
                        }}
                      />
                      {username ? (
                        <View
                          style={{ backgroundColor: c.accentSoft, borderRadius: 12, padding: 12, gap: 2 }}
                        >
                          <Text style={{ color: c.mutedOnBg, fontSize: 13 }}>{g.usernameResult}</Text>
                          <Text selectable style={{ color: c.accent, fontSize: 22, fontWeight: '700' }}>
                            {username}
                          </Text>
                        </View>
                      ) : null}
                      <Text style={{ color: c.muted, fontSize: 12 }}>{g.usernamePrivate}</Text>
                    </View>
                  ) : null}
                  {s.id === 'reset' ? (
                    <Pressable
                      onPress={() => void WebBrowser.openBrowserAsync(GESTIB_HOME)}
                      accessibilityRole="link"
                      style={{
                        minHeight: 46,
                        borderRadius: 12,
                        borderWidth: 1,
                        borderColor: c.accent,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Text style={{ color: c.accent, fontSize: 15, fontWeight: '700' }}>{g.openReset}</Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}
            </View>
          );
        })}
      </View>

      <Pressable
        onPress={() =>
          signedIn ? (router.canGoBack() ? router.back() : router.replace('/')) : router.replace('/sign-in')
        }
        accessibilityRole="button"
        style={({ pressed }) => ({
          minHeight: 52,
          borderRadius: 14,
          backgroundColor: pressed ? c.accentPressed : c.accent,
          alignItems: 'center',
          justifyContent: 'center',
        })}
      >
        <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '700' }}>{g.haveIt}</Text>
      </Pressable>
    </Screen>
  );
}
