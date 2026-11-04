import { Wordmark } from '@/components/Clases';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Banner, Button, Field, H1, P, Screen } from '@/components/ui';
import { api } from '@/lib/api';
import { signInWithToken } from '@/lib/session';

export default function SignIn() {
  const { t, i18n } = useTranslation();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/auth/magic-link', { body: { email: email.trim(), locale: i18n.language } });
      setSent(true);
    } catch {
      setError(t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    const token = /token=([\w-]+)/.exec(link)?.[1] ?? link.trim();
    setBusy(true);
    setError(null);
    try {
      await signInWithToken(token, i18n.language);
      router.replace('/');
    } catch {
      setError(t('signin.invalid'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Wordmark height={30} />
      <H1>{t('signin.title')}</H1>
      {error ? <Banner text={error} tone="danger" /> : null}
      <Field
        label={t('signin.email')}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        inputMode="email"
      />
      <Button
        title={t('signin.send')}
        onPress={send}
        loading={busy && !sent}
        disabled={!/.+@.+\..+/.test(email)}
      />
      {sent ? (
        <>
          <Banner text={t('signin.sent')} tone="ok" />
          <Field
            label={t('signin.paste')}
            value={link}
            onChangeText={setLink}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Button
            title={t('signin.verify')}
            onPress={verify}
            loading={busy}
            disabled={link.length < 20}
            kind="secondary"
          />
        </>
      ) : null}
      <P muted small>
        {t('welcome.disclaimer')}
      </P>
    </Screen>
  );
}
