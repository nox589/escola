import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Banner, Button, Loading, Screen } from '@/components/ui';
import { signInWithToken } from '@/lib/session';

/** Deep link target for magic links: escola://auth?token=… */
export default function AuthLink() {
  const { token } = useLocalSearchParams<{ token?: string }>();
  const { t, i18n } = useTranslation();
  const [state, setState] = useState<'busy' | 'ok' | 'error'>('busy');

  useEffect(() => {
    if (!token) return setState('error');
    signInWithToken(token, i18n.language).then(
      () => setState('ok'),
      () => setState('error'),
    );
  }, [token, i18n.language]);

  if (state === 'ok') return <Redirect href="/" />;
  if (state === 'busy') return <Loading />;
  return (
    <Screen>
      <Banner text={t('signin.invalid')} tone="danger" />
      <Button title={t('signin.title')} onPress={() => router.replace('/sign-in')} kind="secondary" />
    </Screen>
  );
}
