import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Platform, Switch, View } from 'react-native';
import { Badge, Banner, Button, Card, Chip, Divider, Field, H1, H2, P, Row, Screen } from '@/components/ui';
import { UI_LANGUAGES } from '@/i18n';
import { api } from '@/lib/api';
import { CONSENT_VERSION, relative, useAccounts, useConsents, useMe } from '@/lib/hooks';
import { signOut } from '@/lib/session';
import { space, useTheme } from '@/lib/theme';

interface Family {
  id: string;
  name: string;
  members: { id: string; userId: string; email: string; role: string; canSubmit: boolean }[];
}
interface Prefs {
  quietStart: string;
  quietEnd: string;
  grades: boolean;
}

const confirmDialog = (msg: string) =>
  Platform.OS === 'web'
    ? Promise.resolve(globalThis.confirm?.(msg) ?? false)
    : new Promise<boolean>((res) =>
        Alert.alert('', msg, [
          { text: 'Cancel', style: 'cancel', onPress: () => res(false) },
          { text: 'OK', style: 'destructive', onPress: () => res(true) },
        ]),
      );

/** SPEC §11 screen 15. */
export default function Settings() {
  const { t, i18n } = useTranslation();
  const c = useTheme();
  const qc = useQueryClient();
  const me = useMe();
  const accounts = useAccounts();
  const consents = useConsents();
  const family = useQuery({ queryKey: ['family'], queryFn: () => api<Family>('/family') });
  const prefs = useQuery({ queryKey: ['prefs'], queryFn: () => api<Prefs>('/notification-prefs') });
  const [inviteEmail, setInviteEmail] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const isOwner = me.data?.role === 'owner';
  const submitOn = !!consents.data?.some((x) => x.kind === 'mandate_submit');

  const setLang = async (code: string) => {
    await i18n.changeLanguage(code);
    await api('/me', { method: 'PATCH', body: { locale: code } });
    await qc.invalidateQueries();
  };
  const savePrefs = async (p: Partial<Prefs>) => {
    await api('/notification-prefs', { method: 'PUT', body: { ...prefs.data, ...p } });
    await prefs.refetch();
  };
  const toggleSubmitMandate = async () => {
    if (submitOn) await api('/consents/mandate_submit', { method: 'DELETE' });
    else await api('/consents', { body: { kind: 'mandate_submit', version: CONSENT_VERSION } });
    await consents.refetch();
  };
  const accountAction = async (id: string, action: 'pause' | 'resume' | 'remove') => {
    if (action === 'remove') {
      if (!(await confirmDialog(t('settings.remove')))) return;
      await api(`/portal-accounts/${id}`, { method: 'DELETE' });
    } else await api(`/portal-accounts/${id}/${action}`, { method: 'POST' });
    await qc.invalidateQueries();
  };

  return (
    <Screen>
      <H1>{t('settings.title')}</H1>
      {notice ? <Banner text={notice} tone="ok" /> : null}

      <H2>{t('settings.language')}</H2>
      <Row style={{ flexWrap: 'wrap' }}>
        {UI_LANGUAGES.map((l) => (
          <Chip
            key={l.code}
            label={l.label}
            active={i18n.language === l.code}
            onPress={() => void setLang(l.code)}
          />
        ))}
      </Row>

      <H2>{t('settings.gestib')}</H2>
      {(accounts.data ?? []).map((a) => (
        <Card key={a.id}>
          <Row style={{ justifyContent: 'space-between' }}>
            <P>{a.usernameHint}</P>
            <Badge
              label={t(`status.${a.status}` as 'status.active')}
              tone={a.status === 'active' ? 'ok' : a.status === 'paused' ? 'neutral' : 'danger'}
            />
          </Row>
          <P muted small>
            {t('settings.lastSync', {
              when: a.lastSyncAt ? relative(a.lastSyncAt, i18n.language) : t('settings.never'),
            })}
          </P>
          <View style={{ gap: space.s }}>
            <Button
              title={t('settings.updatePassword')}
              kind="secondary"
              onPress={() => router.push({ pathname: '/link-gestib', params: { accountId: a.id } })}
            />
            {a.status === 'paused' ? (
              <Button
                title={t('settings.resume')}
                kind="ghost"
                onPress={() => void accountAction(a.id, 'resume')}
              />
            ) : (
              <Button
                title={t('settings.pause')}
                kind="ghost"
                onPress={() => void accountAction(a.id, 'pause')}
              />
            )}
            {isOwner ? (
              <Button
                title={t('settings.remove')}
                kind="danger"
                onPress={() => void accountAction(a.id, 'remove')}
              />
            ) : null}
          </View>
        </Card>
      ))}

      <H2>{t('settings.notifications')}</H2>
      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <P>{t('settings.quiet')}</P>
          <P muted>{`${prefs.data?.quietStart ?? '21:00'}–${prefs.data?.quietEnd ?? '07:00'}`}</P>
        </Row>
        <Divider />
        <Row style={{ justifyContent: 'space-between' }}>
          <P style={{ flex: 1 }}>{t('settings.grades')}</P>
          <Switch
            value={!!prefs.data?.grades}
            onValueChange={(v) => void savePrefs({ grades: v })}
            trackColor={{ true: c.accent }}
          />
        </Row>
      </Card>

      <H2>{t('settings.family')}</H2>
      <Card>
        {(family.data?.members ?? []).map((m) => (
          <Row key={m.id} style={{ justifyContent: 'space-between' }}>
            <P small style={{ flex: 1 }}>
              {m.email}
            </P>
            <Badge label={m.role} />
            {isOwner && m.role !== 'owner' ? (
              <Switch
                accessibilityLabel={t('settings.canSubmit')}
                value={m.canSubmit}
                onValueChange={(v) =>
                  void api(`/family/members/${m.id}`, { method: 'PATCH', body: { canSubmit: v } }).then(() =>
                    family.refetch(),
                  )
                }
                trackColor={{ true: c.accent }}
              />
            ) : null}
          </Row>
        ))}
        {isOwner ? (
          <View style={{ gap: space.s, marginTop: space.s }}>
            <Field
              label={t('settings.inviteEmail')}
              value={inviteEmail}
              onChangeText={setInviteEmail}
              autoCapitalize="none"
              keyboardType="email-address"
            />
            <Button
              title={t('settings.invite')}
              kind="secondary"
              disabled={!/.+@.+\..+/.test(inviteEmail)}
              onPress={async () => {
                await api('/family/invites', { body: { email: inviteEmail.trim(), role: 'guardian' } });
                setInviteEmail('');
                setNotice(t('settings.inviteSent'));
              }}
            />
          </View>
        ) : null}
      </Card>

      <H2>{t('settings.privacy')}</H2>
      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <P style={{ flex: 1 }}>{t('settings.mandateSubmit')}</P>
          <Switch
            value={submitOn}
            onValueChange={() => void toggleSubmitMandate()}
            trackColor={{ true: c.accent }}
          />
        </Row>
      </Card>
      <Button
        title={t('settings.export')}
        kind="secondary"
        onPress={async () => {
          const { url } = await api<{ url: string }>('/data-requests/export', { method: 'POST' });
          await WebBrowser.openBrowserAsync(url);
        }}
      />
      {isOwner ? (
        <Button
          title={t('settings.delete')}
          kind="danger"
          onPress={async () => {
            if (!(await confirmDialog(t('settings.deleteConfirm')))) return;
            await api('/data-requests/delete', { method: 'POST' });
            await signOut();
            router.replace('/welcome');
          }}
        />
      ) : null}
      <Button
        title={t('settings.signOut')}
        kind="ghost"
        onPress={async () => {
          await signOut();
          qc.clear();
          router.replace('/welcome');
        }}
      />
      <P muted small style={{ textAlign: 'center' }}>
        {t('settings.disclaimer')}
      </P>
    </Screen>
  );
}
