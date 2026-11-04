import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ItemCard } from '@/components/ItemCard';
import { Banner, Chip, H1, H2, P } from '@/components/ui';
import { api, type FeedItem } from '@/lib/api';
import { relative, useChildren, useSummary } from '@/lib/hooks';
import { space, useTheme } from '@/lib/theme';

/** SPEC §11 screen 7: child chips, "Needs action" on top, then the chronological feed. */
export default function Home() {
  const { t, i18n } = useTranslation();
  const c = useTheme();
  const qc = useQueryClient();
  const [child, setChild] = useState<string | null>(null);
  const kids = useChildren();
  const summary = useSummary();

  const feed = useInfiniteQuery({
    queryKey: ['items', child],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api<{ items: FeedItem[]; nextCursor: string | null }>(
        `/items?limit=30${child ? `&child_id=${child}` : ''}${pageParam ? `&cursor=${pageParam}` : ''}`,
      ),
    getNextPageParam: (p) => p.nextCursor,
    refetchInterval: 120_000,
  });
  const items = useMemo(() => feed.data?.pages.flatMap((p) => p.items) ?? [], [feed.data]);
  const needs = items
    .filter((i) => i.action)
    .sort((a, b) => (a.action!.deadlineAt ?? '9').localeCompare(b.action!.deadlineAt ?? '9'));
  const rest = items.filter((i) => !i.action);

  const account = summary.data?.accounts[0];
  const problem = summary.data?.accounts.find((a) => !['active', 'paused'].includes(a.status));

  const refresh = async () => {
    if (account?.status === 'active')
      await api(`/portal-accounts/${account.id}/sync`, { method: 'POST' }).catch(() => undefined);
    await qc.invalidateQueries();
  };

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: c.bg }}>
      <FlatList
        data={rest}
        keyExtractor={(i) => i.id}
        contentContainerStyle={{ padding: space.l, gap: space.m, paddingBottom: space.xxl }}
        refreshControl={
          <RefreshControl refreshing={feed.isRefetching} onRefresh={refresh} tintColor={c.accent} />
        }
        onEndReached={() => feed.hasNextPage && !feed.isFetchingNextPage && void feed.fetchNextPage()}
        ListHeaderComponent={
          <View style={{ gap: space.m }}>
            <H1>Escola</H1>
            {problem ? (
              <Banner
                tone="danger"
                text={t(`problem.${problem.status}.title` as 'problem.locked.title')}
                action={{
                  label: t('home.fix'),
                  onPress: () =>
                    router.push({ pathname: '/account-problem/[id]', params: { id: problem.id } }),
                }}
              />
            ) : account?.stale ? (
              <Banner text={t('home.stale', { when: relative(account.lastSyncAt, i18n.language) })} />
            ) : null}
            {(kids.data?.length ?? 0) > 1 ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: space.s }}
              >
                <Chip label={t('home.all')} active={!child} onPress={() => setChild(null)} />
                {kids.data!.map((k) => (
                  <Chip
                    key={k.id}
                    label={k.displayName}
                    colour={k.colour}
                    active={child === k.id}
                    onPress={() => setChild(k.id)}
                  />
                ))}
              </ScrollView>
            ) : null}
            {needs.length ? (
              <View style={{ gap: space.m }}>
                <H2>{`${t('home.needsAction')} · ${needs.length}`}</H2>
                {needs.map((i) => (
                  <ItemCard key={i.id} item={i} />
                ))}
              </View>
            ) : null}
            {rest.length ? <H2>{t('home.updates')}</H2> : null}
            {!feed.isLoading && !items.length ? <P muted>{t('home.empty')}</P> : null}
          </View>
        }
        renderItem={({ item }) => <ItemCard item={item} />}
      />
    </SafeAreaView>
  );
}
