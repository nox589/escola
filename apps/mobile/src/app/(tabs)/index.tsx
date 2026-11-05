import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CallSchoolButton } from '@/components/CallSchool';
import { AppHeader, AskBar } from '@/components/Clases';
import { ComingUp, type Period, PeriodToggle } from '@/components/Period';
import { AbsenceCard, ItemCard, NeedsCard } from '@/components/ItemCard';
import { Banner, Chip, P } from '@/components/ui';
import { WebSetup } from '@/components/WebSetup';
import { api, type FeedItem } from '@/lib/api';
import { relative, useAbsences, useChildren, useSummary } from '@/lib/hooks';
import { firstName, isCurrent, sortTodos } from '@/lib/todo';
import { font, space, useTheme } from '@/lib/theme';

/**
 * Today: everything for all children. Current shows what needs you, what is coming up and recent
 * updates; Past holds the rest. Tapping a child opens that child's page.
 */
export default function Today() {
  const { t, i18n } = useTranslation();
  const c = useTheme();
  const qc = useQueryClient();
  const [period, setPeriod] = useState<Period>('current');
  const kids = useChildren();
  const summary = useSummary();
  const absences = useAbsences();
  const openAbsences = (absences.data ?? []).filter((a) => a.status === 'unjustified');

  const feed = useInfiniteQuery({
    queryKey: ['items', null],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api<{ items: FeedItem[]; nextCursor: string | null }>(
        `/items?limit=50${pageParam ? `&cursor=${pageParam}` : ''}`,
      ),
    getNextPageParam: (p) => p.nextCursor,
    refetchInterval: 120_000,
  });
  const all = useMemo(() => feed.data?.pages.flatMap((p) => p.items) ?? [], [feed.data]);
  // Conversations live in Messages; Today keeps to-dos plus circulars, notices and activities.
  const current = all.filter((i) => isCurrent(i));
  const needs = period === 'current' ? current.filter((i) => i.action) : [];
  const rest =
    period === 'current'
      ? current.filter((i) => !i.action && i.section !== 'message')
      : all.filter((i) => !isCurrent(i) && i.section !== 'message');
  const todos = period === 'current' ? openAbsences : [];

  const account = summary.data?.accounts[0];
  const problem = summary.data?.accounts.find((a) => !['active', 'paused'].includes(a.status));
  const refresh = async () => {
    if (account?.status === 'active')
      await api(`/portal-accounts/${account.id}/sync`, { method: 'POST' }).catch(() => undefined);
    await qc.invalidateQueries();
  };

  const H = ({ children }: { children: string }) => (
    <Text accessibilityRole="header" style={{ color: c.ink, fontSize: font.h2, fontWeight: '700' }}>
      {children}
    </Text>
  );

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: c.bg }}>
      <FlatList
        data={rest}
        keyExtractor={(i) => i.id}
        contentContainerStyle={{ padding: space.xl, gap: 10, paddingBottom: space.xxl }}
        refreshControl={
          <RefreshControl refreshing={feed.isRefetching} onRefresh={refresh} tintColor={c.accent} />
        }
        onEndReached={() =>
          period === 'past' && feed.hasNextPage && !feed.isFetchingNextPage && void feed.fetchNextPage()
        }
        ListHeaderComponent={
          <View style={{ gap: 18, marginBottom: 2 }}>
            <AppHeader right={kids.data?.length ? <CallSchoolButton kids={kids.data} /> : null} />
            <AskBar hint={t('cl.ask')} />
            <WebSetup />
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
                <Chip label={t('cl.all')} active onPress={() => undefined} />
                {kids.data!.map((k) => (
                  <Chip
                    key={k.id}
                    label={firstName(k.displayName)}
                    colour={k.colour}
                    active={false}
                    onPress={() => router.push({ pathname: '/child/[id]', params: { id: k.id } })}
                  />
                ))}
              </ScrollView>
            ) : null}

            <PeriodToggle value={period} onChange={setPeriod} />

            {period === 'current' ? (
              <View style={{ gap: 10 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <H>{t('cl.needsYou')}</H>
                  {needs.length + todos.length ? (
                    <Text
                      style={{
                        backgroundColor: c.lime,
                        color: c.ink,
                        fontWeight: '700',
                        fontSize: 13,
                        paddingHorizontal: 10,
                        paddingVertical: 2,
                        borderRadius: 10,
                        overflow: 'hidden',
                      }}
                    >
                      {t('cl.toDo', { count: needs.length + todos.length })}
                    </Text>
                  ) : null}
                </View>
                {sortTodos([
                  ...needs.map((item) => ({ kind: 'item' as const, item })),
                  ...todos.map((a) => ({ kind: 'absence' as const, a })),
                ]).map((td) =>
                  td.kind === 'item' ? (
                    <NeedsCard key={td.item.id} item={td.item} />
                  ) : (
                    <AbsenceCard key={td.a.id} a={td.a} />
                  ),
                )}
                {!needs.length && !todos.length && !feed.isLoading ? (
                  <P muted small>
                    {t('cl.nothingNeeds')}
                  </P>
                ) : null}
              </View>
            ) : null}

            {period === 'current' ? <ComingUp /> : null}

            {rest.length ? <H>{t('cl.updates')}</H> : null}
            {!feed.isLoading && !all.length ? <P muted>{t('home.empty')}</P> : null}
            {period === 'past' && !feed.isLoading && all.length && !rest.length ? (
              <P muted small>
                {t('cl.nothingPast')}
              </P>
            ) : null}
          </View>
        }
        renderItem={({ item }) => <ItemCard item={item} />}
      />
    </SafeAreaView>
  );
}
