import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Button, H1, P, Screen } from '@/components/ui';
import { registerForPush } from '@/lib/push';

/** SPEC §11 screen 6: explain first, then the OS prompt. */
export default function NotificationsSetup() {
  const { t, i18n } = useTranslation();
  const [busy, setBusy] = useState(false);
  const enable = async () => {
    setBusy(true);
    await registerForPush(i18n.language).catch(() => false);
    setBusy(false);
    router.replace('/(tabs)');
  };
  return (
    <Screen>
      <View style={{ flex: 1, justifyContent: 'center', gap: 16 }}>
        <H1>{t('notif.title')}</H1>
        <P>{t('notif.body')}</P>
      </View>
      <Button title={t('notif.enable')} onPress={enable} loading={busy} />
      <Button title={t('notif.skip')} onPress={() => router.replace('/(tabs)')} kind="ghost" />
    </Screen>
  );
}
