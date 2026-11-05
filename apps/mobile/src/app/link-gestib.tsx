import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';
import { Banner, Button, Card, Field, H1, P, Screen } from '@/components/ui';
import { api, ApiError, type PortalAccount } from '@/lib/api';
import { font, space, useTheme } from '@/lib/theme';

/**
 * SPEC §11 screen 4. Also used to update the password (?accountId=…). The password goes straight to
 * the API, which encrypts it immediately; the app never stores it.
 */
export default function LinkGestib() {
  const { t } = useTranslation();
  const c = useTheme();
  const qc = useQueryClient();
  const { accountId } = useLocalSearchParams<{ accountId?: string }>();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (accountId) {
        await api<PortalAccount>(`/portal-accounts/${accountId}/credentials`, {
          method: 'PUT',
          body: { username: username.trim(), password },
        });
      } else {
        await api<PortalAccount>('/portal-accounts', {
          body: { portal: 'gestib', username: username.trim(), password },
        });
      }
      setPassword('');
      await qc.invalidateQueries();
      router.replace(accountId ? '/(tabs)' : '/children');
    } catch (e) {
      setError(
        e instanceof ApiError && e.code === 'mandate_read_consent_required'
          ? t('consent.read')
          : t('common.error'),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <H1>{accountId ? t('settings.updatePassword') : t('link.title')}</H1>
      {error ? <Banner text={error} tone="danger" /> : null}
      <Field
        label={t('link.username')}
        value={username}
        onChangeText={setUsername}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="username"
        textContentType="username"
      />
      <View>
        <Field
          label={t('link.password')}
          value={password}
          onChangeText={setPassword}
          secureTextEntry={!show}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="password"
          textContentType="password"
        />
        <Pressable
          onPress={() => setShow((s) => !s)}
          style={{ position: 'absolute', right: space.m, bottom: 12 }}
          accessibilityRole="button"
        >
          <Text style={{ color: c.accent, fontSize: font.small, fontWeight: '600' }}>
            {show ? t('link.hide') : t('link.show')}
          </Text>
        </Pressable>
      </View>
      <P muted small>
        {t('link.clave')}
      </P>
      <Pressable onPress={() => router.push('/guide')} accessibilityRole="link" style={{ minHeight: 44, justifyContent: 'center' }}>
        <Text style={{ color: c.accent, fontSize: font.small, fontWeight: '700' }}>{t('link.help')} ›</Text>
      </Pressable>
      <Card>
        <P small>🔒 {t('link.security')}</P>
      </Card>
      <Button
        title={busy ? t('link.checking') : t('link.submit')}
        onPress={submit}
        loading={busy}
        disabled={!username || password.length < 1}
      />
    </Screen>
  );
}
