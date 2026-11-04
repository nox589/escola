import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, TextInput, View } from 'react-native';
import { Banner, Button, Card, H1, P, Row, Screen } from '@/components/ui';
import { api, type Child, type PortalAccount } from '@/lib/api';
import { CHILD_COLOURS, font, space, useTheme } from '@/lib/theme';

/** SPEC §11 screen 5: children found in GestIB; rename and pick a colour. Polls until the first sync lands. */
export default function Children() {
  const { t } = useTranslation();
  const c = useTheme();
  const qc = useQueryClient();
  const kids = useQuery({
    queryKey: ['children'],
    queryFn: () => api<Child[]>('/children'),
    refetchInterval: 3000,
  });
  const accounts = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api<PortalAccount[]>('/portal-accounts'),
    refetchInterval: 3000,
  });
  const [names, setNames] = useState<Record<string, string>>({});
  const problem = accounts.data?.find((a) => a.status !== 'active' && a.status !== 'paused');
  // Wait for the first sync to finish so every child is listed before continuing.
  const synced = !!accounts.data?.some((a) => a.lastSyncAt);

  const save = async () => {
    for (const [i, k] of (kids.data ?? []).entries()) {
      await api(`/children/${k.id}`, {
        method: 'PATCH',
        body: {
          displayName: names[k.id]?.trim() || k.displayName,
          colour: k.colour ?? CHILD_COLOURS[i % CHILD_COLOURS.length],
        },
      });
    }
    await qc.invalidateQueries();
    router.replace('/notifications');
  };

  return (
    <Screen>
      <H1>{t('children.title')}</H1>
      {problem ? (
        <Banner
          text={t(`problem.${problem.status}.title` as 'problem.locked.title')}
          tone="danger"
          action={{
            label: t('home.fix'),
            onPress: () => router.push({ pathname: '/account-problem/[id]', params: { id: problem.id } }),
          }}
        />
      ) : null}
      {!kids.data?.length ? (
        <Card>
          <P muted>{t('children.waiting')}</P>
        </Card>
      ) : (
        kids.data.map((k, i) => {
          const colour = k.colour ?? CHILD_COLOURS[i % CHILD_COLOURS.length]!;
          return (
            <Card key={k.id} accent={colour}>
              <P muted small>
                {t('children.rename')}
              </P>
              <TextInput
                value={names[k.id] ?? k.displayName}
                onChangeText={(v) => setNames((s) => ({ ...s, [k.id]: v }))}
                style={{ fontSize: font.h2, color: c.ink, paddingVertical: 4 }}
                accessibilityLabel={t('children.rename')}
              />
              {k.schoolName ? (
                <P muted small>
                  {[k.schoolName, k.classLabel].filter(Boolean).join(' · ')}
                </P>
              ) : null}
              <Row style={{ marginTop: space.xs }}>
                {CHILD_COLOURS.map((col) => (
                  <Pressable
                    key={col}
                    accessibilityLabel={col}
                    onPress={() =>
                      void api(`/children/${k.id}`, { method: 'PATCH', body: { colour: col } }).then(() =>
                        kids.refetch(),
                      )
                    }
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: 13,
                      backgroundColor: col,
                      borderWidth: col === colour ? 3 : 0,
                      borderColor: c.ink,
                    }}
                  />
                ))}
              </Row>
            </Card>
          );
        })
      )}
      <View style={{ flex: 1 }} />
      <Button
        title={t('children.continue')}
        onPress={save}
        disabled={!kids.data?.length || !synced}
        loading={!!kids.data?.length && !synced}
      />
    </Screen>
  );
}
