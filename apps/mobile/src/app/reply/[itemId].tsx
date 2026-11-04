import { useQuery } from '@tanstack/react-query';
import * as LocalAuthentication from 'expo-local-authentication';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, View } from 'react-native';
import { Banner, Button, Card, Field, H1, H2, Loading, P, Screen } from '@/components/ui';
import { api, ApiError, type ItemDetail, type Submission } from '@/lib/api';
import { useMe } from '@/lib/hooks';
import { space, useTheme } from '@/lib/theme';

/**
 * Reception (SPEC §9, screens 11–12): write in your language → three-pane preview
 * (your words | exact text the school receives | back-translation) → Face ID + tap → queued.
 * Any edit produces a new preview hash and invalidates earlier confirmations server-side.
 */
async function reauthenticate(prompt: string): Promise<boolean> {
  if (Platform.OS === 'web') return true;
  const has = await LocalAuthentication.hasHardwareAsync();
  const enrolled = has && (await LocalAuthentication.isEnrolledAsync());
  if (!enrolled) return true; // device has no biometrics/passcode: the explicit tap is the confirmation
  const r = await LocalAuthentication.authenticateAsync({ promptMessage: prompt });
  return r.success;
}

export default function Reply() {
  const { itemId } = useLocalSearchParams<{ itemId: string }>();
  const { t } = useTranslation();
  const c = useTheme();
  const me = useMe();
  const item = useQuery({ queryKey: ['item', itemId], queryFn: () => api<ItemDetail>(`/items/${itemId}`) });
  const [text, setText] = useState('');
  const [sub, setSub] = useState<Submission | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!item.data || !me.data) return <Loading />;

  const errorText = (e: unknown) => {
    const code = e instanceof ApiError ? e.code : '';
    if (code === 'kind_not_enabled') return t('reply.notEnabled');
    if (code === 'not_allowed_to_submit') return t('reply.cantSubmit');
    if (code === 'mandate_submit_consent_required') return t('reply.mandate');
    return t('common.error');
  };

  const prepare = async () => {
    setBusy(true);
    setError(null);
    try {
      const body = { user_input: { text } };
      const s = sub
        ? await api<Submission>(`/submissions/${sub.id}`, { method: 'PATCH', body })
        : await api<Submission>('/submissions', {
            body: { kind: 'reply_message', child_id: item.data.child!.id, item_id: itemId, ...body },
          });
      setSub(s);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!sub?.previewHash) return;
    if (!(await reauthenticate(t('reply.biometric')))) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/submissions/${sub.id}/confirm`, {
        body: { preview_hash: sub.previewHash },
        headers: { 'x-device-id': Platform.OS },
      });
      router.replace({ pathname: '/submission/[id]', params: { id: sub.id } });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <H1>{t('reply.title')}</H1>
      <P muted small>
        {item.data.translation?.title ?? item.data.original.title}
      </P>
      {!me.data.canSubmit ? <Banner text={t('reply.cantSubmit')} /> : null}
      {error ? <Banner text={error} tone="danger" /> : null}

      {!sub || sub.state === 'draft' ? (
        <>
          <Field
            label={t('reply.yours')}
            placeholder={t('reply.placeholder')}
            value={text}
            onChangeText={setText}
            multiline
          />
          <Button title={t('reply.prepare')} onPress={prepare} loading={busy} disabled={!text.trim()} />
        </>
      ) : (
        <View style={{ gap: space.m }}>
          <H2>{t('reply.previewTitle')}</H2>
          <Card>
            <P muted small>
              {t('reply.yourWords')}
            </P>
            <P>{text}</P>
          </Card>
          <Card accent={c.accent}>
            <P muted small>
              {t('reply.schoolGets')}
            </P>
            <P style={{ fontWeight: '600' }}>{sub.draftOriginal ?? ''}</P>
          </Card>
          <Card>
            <P muted small>
              {t('reply.backTranslation')}
            </P>
            <P muted>{sub.preview ?? ''}</P>
          </Card>
          <Button title={t('reply.confirm')} onPress={confirm} loading={busy} disabled={!me.data.canSubmit} />
          <Button title={t('reply.edit')} kind="ghost" onPress={() => setSub({ ...sub, state: 'draft' })} />
        </View>
      )}
    </Screen>
  );
}
