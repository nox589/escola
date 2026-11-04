import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Button, Card, H1, Loading, P, Screen } from '@/components/ui';
import { api, type PortalAccount } from '@/lib/api';

/** SPEC §11 screen 17: clear explanation + one fix button. */
export default function AccountProblem() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['account', id],
    queryFn: () => api<PortalAccount>(`/portal-accounts/${id}`),
  });
  if (!q.data) return <Loading />;
  const a = q.data;
  const key = (a.status === 'active' ? 'paused' : a.status) as 'locked';

  return (
    <Screen>
      <H1>{t(`problem.${key}.title`)}</H1>
      <Card>
        <P>{t(`problem.${key}.body`)}</P>
        <P muted small>
          {a.usernameHint}
        </P>
      </Card>
      {a.status === 'paused' ? (
        <Button
          title={t('settings.resume')}
          onPress={async () => {
            await api(`/portal-accounts/${id}/resume`, { method: 'POST' });
            await qc.invalidateQueries();
            router.back();
          }}
        />
      ) : (
        <Button
          title={t('settings.updatePassword')}
          onPress={() => router.push({ pathname: '/link-gestib', params: { accountId: id } })}
        />
      )}
    </Screen>
  );
}
