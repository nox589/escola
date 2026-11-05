import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CallSchoolButton } from '@/components/CallSchool';
import { AppHeader, AskBar } from '@/components/Clases';
import { ComingUp, SeeAll } from '@/components/Period';
import { AbsenceCard, ItemCard, NeedsCard } from '@/components/ItemCard';
import { Banner, Chip, P } from '@/components/ui';
import { WebSetup } from '@/components/WebSetup';
import { api, type FeedItem } from '@/lib/api';
import { relative, useAbsences, useChildren, useSummary } from '@/lib/hooks';
import { firstName, sortTodos } from '@/lib/todo';
import { font, space, useTheme } from '@/lib/theme';

/**
 * Today: the family feed. Every open to-do (it only leaves when the parent acts on it), what is
 * coming up, then updates newest first. Tapping a child opens that child's page.
 */
export default function Today() {
  const { t, i18n } = useTranslation();
  const c = useTheme();
  const qc = useQueryClient();
  const [allUpdates, setAllUpdates] = useState(false);
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
  // Every open to-do, however old: it stays until the parent signs, replies, justifies or dismisses it.
  const open = useQuery({
    queryKey: ['items', 'needs'],
    queryFn: () => api<{ items: FeedItem[] }>('/items?needs_action=true&limit=100'),
    refetchInterval: 120_000,
  });
  const needs = open.data?.items ?? [];
  const todos = openAbsences;
  // Conversations live in Messages; updates are circulars, notices and activities.
  const updates = all.filter((i) => !i.action && i.section !== 'message');
  const UPDATES_SHOWN = 5;
  const rest = allUpdates ? updates : updates.slice(0, UPDATES_SHOWN);

  const account = summary.data?.accounts[0];
  const problem = summary.data?.accounts.find((a) => !['active', 'paused'].includes(a.status));
  const [syncing, setSyncing] = useState(false);
  const refresh = async () => {
    if (account?.status === 'active')
      await api(`/portal-accounts/${account.id}/sync`, { method: 'POST' }).catch(() => undefined);
    await qc.invalidateQueries();
  };
  // Web has no pull-to-refresh: a tap asks GestIB again; a sync takes a minute or two.
  const syncNow = async () => {
    setSyncing(true);
    await refresh();
    for (const ms of [45_000, 90_000, 150_000]) setTimeout(() => void qc.invalidateQueries(), ms);
    setTimeout(() => setSyncing(false), 150_000);
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
          allUpdates && feed.hasNextPage && !feed.isFetchingNextPage && void feed.fetchNextPage()
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
              {!needs.length && !todos.length && !open.isLoading ? (
                <P muted small>
                  {t('cl.nothingNeeds')}
                </P>
              ) : null}
            </View>

            {account ? (
              <Pressable
                onPress={() => void syncNow()}
                disabled={syncing}
                accessibilityRole="button"
                style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: -6 }}
              >
                <Text style={{ color: c.muted, fontSize: 13 }}>
                  {syncing
                    ? t('cl.syncing')
                    : t('cl.child.synced', { when: relative(account.lastSyncAt, i18n.language) })}
                </Text>
                {!syncing ? (
                  <Text style={{ color: c.accent, fontSize: 13, fontWeight: '700' }}>
                    · {t('cl.syncNow')}
                  </Text>
                ) : null}
              </Pressable>
            ) : null}

            <ComingUp limit={3} onSeeAll={() => router.navigate('/calendar')} />

            {rest.length ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <H>{t('cl.updates')}</H>
                {!allUpdates && updates.length > UPDATES_SHOWN ? (
                  <SeeAll onPress={() => setAllUpdates(true)} />
                ) : null}
              </View>
            ) : null}
            {!feed.isLoading && !all.length ? <P muted>{t('home.empty')}</P> : null}
          </View>
        }
        renderItem={({ item }) => <ItemCard item={item} />}
        ListFooterComponent={
          !allUpdates && updates.length > UPDATES_SHOWN ? (
            <View style={{ alignItems: 'center', marginTop: 4 }}>
              <SeeAll
                onPress={() => setAllUpdates(true)}
                label={t('cl.seeAllUpdates', { count: updates.length })}
              />
            </View>
          ) : undefined
        }
      />
    </SafeAreaView>
  );
}
