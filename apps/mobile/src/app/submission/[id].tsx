import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Image, View } from 'react-native';
import { Badge, Banner, Card, H1, Loading, P, Row, Screen } from '@/components/ui';
import { api, type Submission } from '@/lib/api';
import { space, useTheme } from '@/lib/theme';

const FINAL = ['succeeded', 'failed', 'needs_manual'];

/** SPEC §11 screen 13: status timeline and receipt screenshot. */
export default function SubmissionStatus() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const c = useTheme();
  const q = useQuery({
    queryKey: ['submission', id],
    queryFn: () => api<Submission>(`/submissions/${id}`),
    refetchInterval: (s) => (s.state.data && FINAL.includes(s.state.data.state) ? false : 2000),
  });
  if (!q.data) return <Loading />;
  const s = q.data;
  const steps = ['queued', 'submitting', 'verifying', 'succeeded'];
  const reached = steps.indexOf(s.state);

  return (
    <Screen>
      <H1>{t(`submission.states.${s.state}` as 'submission.states.queued')}</H1>
      {s.state === 'needs_manual' ? <Banner text={t('submission.manual')} /> : null}
      {s.state === 'failed' ? <Banner text={t('submission.failed')} tone="danger" /> : null}
      <Card>
        {steps.map((st, i) => (
          <Row key={st}>
            <View
              style={{
                width: 10,
                height: 10,
                borderRadius: 5,
                backgroundColor: i <= reached ? c.accent : c.line,
              }}
            />
            <P muted={i > reached}>{t(`submission.states.${st}` as 'submission.states.queued')}</P>
            {i === reached && !FINAL.includes(s.state) ? (
              <ActivityIndicator size="small" color={c.accent} />
            ) : null}
          </Row>
        ))}
      </Card>
      <Card>
        <P muted small>
          {t('reply.schoolGets')}
        </P>
        <P>{s.draftOriginal ?? ''}</P>
      </Card>
      {s.receipt ? (
        <View style={{ gap: space.s }}>
          <Row>
            <Badge label={t('submission.receipt')} tone="ok" />
            {s.receipt.confirmationRef ? (
              <P muted small>
                {s.receipt.confirmationRef}
              </P>
            ) : null}
          </Row>
          {s.receipt.screenshotUrl ? (
            <Image
              source={{ uri: s.receipt.screenshotUrl }}
              style={{
                width: '100%',
                aspectRatio: 0.6,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: c.line,
              }}
              resizeMode="contain"
            />
          ) : null}
        </View>
      ) : null}
    </Screen>
  );
}
