import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Switch } from 'react-native';
import { Badge, Button, Card, H1, P, Row, Screen } from '@/components/ui';
import { api } from '@/lib/api';
import { CONSENT_VERSION } from '@/lib/hooks';
import { useTheme } from '@/lib/theme';

type Toggle = 'terms' | 'mandate_read' | 'mandate_submit' | 'ai_processing';

/** SPEC §11 screen 3: plain-language cards; reading and submitting are separate mandates. */
export default function Consent() {
  const { t } = useTranslation();
  const c = useTheme();
  const qc = useQueryClient();
  const [on, setOn] = useState<Record<Toggle, boolean>>({
    terms: false,
    mandate_read: false,
    mandate_submit: false,
    ai_processing: false,
  });
  const [busy, setBusy] = useState(false);
  const ready = on.terms && on.mandate_read && on.ai_processing;

  const toggle = (k: Toggle) => setOn((s) => ({ ...s, [k]: !s[k] }));
  const item = (k: Toggle, text: string, optional = false) => (
    <Pressable onPress={() => toggle(k)} accessibilityRole="switch" accessibilityState={{ checked: on[k] }}>
      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <Badge
            label={optional ? t('consent.optional') : t('consent.required')}
            tone={optional ? 'neutral' : 'ok'}
          />
          <Switch value={on[k]} onValueChange={() => toggle(k)} trackColor={{ true: c.accent }} />
        </Row>
        <P>{text}</P>
      </Card>
    </Pressable>
  );

  const save = async () => {
    setBusy(true);
    try {
      const kinds = [
        ...(on.terms ? ['tos', 'privacy'] : []),
        ...(['mandate_read', 'mandate_submit', 'ai_processing'] as const).filter((k) => on[k]),
      ];
      for (const kind of kinds) await api('/consents', { body: { kind, version: CONSENT_VERSION } });
      await qc.invalidateQueries({ queryKey: ['consents'] });
      router.replace('/link-gestib');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <H1>{t('consent.title')}</H1>
      <P muted>{t('consent.intro')}</P>
      <Card>
        <P>{t('consent.access')}</P>
        <P muted small>
          {t('consent.vault')}
        </P>
      </Card>
      {item('mandate_read', t('consent.read'))}
      {item('mandate_submit', t('consent.submit'), true)}
      {item('ai_processing', t('consent.ai'))}
      {item('terms', `${t('consent.terms')}. ${t('consent.eu')}`)}
      <Button title={t('consent.agree')} onPress={save} loading={busy} disabled={!ready} />
    </Screen>
  );
}
