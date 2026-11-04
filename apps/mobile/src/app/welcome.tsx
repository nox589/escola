import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import { Button, Chip, H1, P, Screen } from '@/components/ui';
import { UI_LANGUAGES } from '@/i18n';
import { font, space, useTheme } from '@/lib/theme';

export default function Welcome() {
  const { t, i18n } = useTranslation();
  const c = useTheme();
  return (
    <Screen>
      <View style={{ flex: 1, justifyContent: 'center', gap: space.xl }}>
        <View
          style={{
            width: 64,
            height: 64,
            borderRadius: 18,
            backgroundColor: c.accent,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ color: '#fff', fontSize: 34, fontWeight: '800' }}>e</Text>
        </View>
        <H1>Escola</H1>
        <Text style={{ fontSize: font.h2, color: c.ink, lineHeight: 28 }}>{t('welcome.tagline')}</Text>
        <View style={{ gap: space.s }}>
          <P muted small>
            {t('welcome.language')}
          </P>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
            {UI_LANGUAGES.map((l) => (
              <Chip
                key={l.code}
                label={l.label}
                active={i18n.language === l.code}
                onPress={() => void i18n.changeLanguage(l.code)}
              />
            ))}
          </View>
        </View>
      </View>
      <Button title={t('welcome.continue')} onPress={() => router.push('/sign-in')} />
      <P muted small style={{ textAlign: 'center' }}>
        {t('welcome.disclaimer')}
      </P>
    </Screen>
  );
}
