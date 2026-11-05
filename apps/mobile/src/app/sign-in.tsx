import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';
import {
  CREAM,
  TealButton,
  TealField,
  TealFooter,
  TealNote,
  TealScreen,
  TealTitle,
  TealWordmark,
} from '@/components/Teal';
import { api } from '@/lib/api';
import { signInWithToken } from '@/lib/session';

/** Sign in with an emailed link (no MiCole password). Same teal look as Welcome. */
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
    <TealScreen back={t('common.back')}>
      <TealWordmark height={36} />
      <TealTitle lead={t('signin.lead')}>{t('signin.title')}</TealTitle>
      {error ? <TealNote text={error} tone="danger" /> : null}
      <TealField
        label={t('signin.email')}
        value={email}
        onChangeText={setEmail}
        placeholder="you@example.com"
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        inputMode="email"
        onSubmitEditing={() => /.+@.+\..+/.test(email) && void send()}
      />
      <TealButton
        title={t('signin.send')}
        onPress={() => void send()}
        loading={busy && !sent}
        disabled={!/.+@.+\..+/.test(email)}
      />
      {sent ? (
        <View style={{ gap: 18 }}>
          <TealNote text={t('signin.sent')} tone="ok" />
          <TealField
            label={t('signin.paste')}
            value={link}
            onChangeText={setLink}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TealButton
            title={t('signin.verify')}
            onPress={() => void verify()}
            loading={busy}
            disabled={link.length < 20}
            kind="outline"
          />
        </View>
      ) : null}
      <View style={{ flex: 1 }} />
      <Pressable
        onPress={() => router.push('/guide')}
        accessibilityRole="link"
        style={{ minHeight: 44, alignItems: 'center', justifyContent: 'center' }}
      >
        <Text style={{ color: CREAM, fontSize: 15, fontWeight: '600', textDecorationLine: 'underline' }}>
          {t('welcome.needPassword')}
        </Text>
      </Pressable>
      <TealFooter text={t('welcome.private')} />
    </TealScreen>
  );
}
