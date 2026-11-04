import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader, AskBar } from '@/components/Clases';
import { AbsenceCard, ItemCard, NeedsCard } from '@/components/ItemCard';
import { Banner, Chip, P } from '@/components/ui';
import { WebSetup } from '@/components/WebSetup';
import { api, type FeedItem } from '@/lib/api';
import { relative, useAbsences, useChildren, useSummary } from '@/lib/hooks';
import { font, space, useTheme } from '@/lib/theme';

/** Today: one translated stream. "Needs you" on top, updates underneath, filtered by child. */
export default function Today() {
  const { t, i18n } = useTranslation();
  const c = useTheme();
  const qc = useQueryClient();
  const [child, setChild] = useState<string | null>(null);
  const kids = useChildren();
  const summary = useSummary();
  const absences = useAbsences();
  const openAbsences = (absences.data ?? []).filter((a) => a.status === 'unjustified' && (!child || a.child.id === child));

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
  const selected = kids.data?.find((k) => k.id === child);

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
        refreshControl={<RefreshControl refreshing={feed.isRefetching} onRefresh={refresh} tintColor={c.accent} />}
        onEndReached={() => feed.hasNextPage && !feed.isFetchingNextPage && void feed.fetchNextPage()}
        ListHeaderComponent={
          <View style={{ gap: 18, marginBottom: 2 }}>
            <AppHeader />
            <AskBar hint={t('cl.ask')} />
            <WebSetup />
            {problem ? (
              <Banner
                tone="danger"
                text={t(`problem.${problem.status}.title` as 'problem.locked.title')}
                action={{
                  label: t('home.fix'),
                  onPress: () => router.push({ pathname: '/account-problem/[id]', params: { id: problem.id } }),
                }}
              />
            ) : account?.stale ? (
              <Banner text={t('home.stale', { when: relative(account.lastSyncAt, i18n.language) })} />
            ) : null}

            {(kids.data?.length ?? 0) > 1 ? (
              <View style={{ gap: 6 }}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.s }}>
                  <Chip label={t('cl.all')} active={!child} onPress={() => setChild(null)} />
                  {kids.data!.map((k) => (
                    <Chip key={k.id} label={k.displayName} colour={k.colour} active={child === k.id} onPress={() => setChild(k.id)} />
                  ))}
                </ScrollView>
                {selected ? (
                  <Pressable
                    onPress={() => router.push({ pathname: '/child/[id]', params: { id: selected.id } })}
                    accessibilityRole="link"
                    style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
                  >
                    <Text style={{ color: c.ink, fontSize: font.small }}>
                      <Text style={{ fontWeight: '700' }}>{selected.displayName}</Text>
                      {selected.classLabel ? <Text style={{ color: c.mutedOnBg }}>{` · ${selected.classLabel}`}</Text> : null}
                    </Text>
                    <Text style={{ color: c.accent, fontWeight: '700', fontSize: font.small }}>
                      {t('cl.openPage', { name: selected.displayName })} ›
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}

            <View style={{ gap: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <H>{t('cl.needsYou')}</H>
                {needs.length + openAbsences.length ? (
                  <Text
                    style={{ backgroundColor: c.lime, color: c.ink, fontWeight: '700', fontSize: 13, paddingHorizontal: 10, paddingVertical: 2, borderRadius: 10, overflow: 'hidden' }}
                  >
                    {t('cl.toDo', { count: needs.length + openAbsences.length })}
                  </Text>
                ) : null}
              </View>
              {openAbsences.map((a) => (
                <AbsenceCard key={a.id} a={a} />
              ))}
              {needs.map((i) => (
                <NeedsCard key={i.id} item={i} />
              ))}
              {!needs.length && !openAbsences.length && !feed.isLoading ? <P muted small>{t('cl.nothingNeeds')}</P> : null}
            </View>

            {rest.length ? <H>{t('cl.updates')}</H> : null}
            {!feed.isLoading && !items.length ? <P muted>{t('home.empty')}</P> : null}
          </View>
        }
        renderItem={({ item }) => <ItemCard item={item} />}
      />
    </SafeAreaView>
  );
}
