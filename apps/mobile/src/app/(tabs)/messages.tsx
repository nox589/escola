import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AskBar, Dot } from '@/components/Clases';
import { P } from '@/components/ui';
import { relative, useThreads } from '@/lib/hooks';
import { font, space, useTheme } from '@/lib/theme';

/** Messages: one conversation per teacher or office, newest first, like a chat app's inbox. */
export default function Messages() {
  const { t, i18n } = useTranslation();
  const c = useTheme();
  const threads = useThreads();

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: c.bg }}>
      <FlatList
        data={threads.data ?? []}
        keyExtractor={(x) => x.key}
        contentContainerStyle={{ padding: space.xl, gap: 8, paddingBottom: space.xxl }}
        refreshControl={<RefreshControl refreshing={threads.isRefetching} onRefresh={() => void threads.refetch()} tintColor={c.accent} />}
        ListHeaderComponent={
          <View style={{ gap: 16, marginBottom: 6 }}>
            <Text accessibilityRole="header" style={{ color: c.ink, fontSize: font.title, fontWeight: '700', paddingTop: space.s }}>
              {t('cl.messages')}
            </Text>
            <AskBar hint={t('cl.askMessages')} />
            {!threads.isLoading && !threads.data?.length ? <P muted small>{t('cl.noMessages')}</P> : null}
          </View>
        }
        renderItem={({ item: th }) => {
          const name = th.sender ?? t('cl.school');
          return (
            <Pressable
              onPress={() => router.push({ pathname: '/thread/[key]', params: { key: th.key } })}
              accessibilityRole="button"
              accessibilityLabel={`${name}${th.unread ? `, ${t('cl.unread', { count: th.unread })}` : ''}`}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                padding: 12,
                borderRadius: 16,
                backgroundColor: pressed ? c.accentSoft : c.card,
                borderWidth: 1,
                borderColor: c.line,
              })}
            >
              <View style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: c.accent, fontSize: 18, fontWeight: '700' }}>{name.trim()[0]?.toUpperCase() ?? '?'}</Text>
              </View>
              <View style={{ flex: 1, gap: 3 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={{ color: c.ink, fontSize: 16, fontWeight: th.unread ? '700' : '600', flexShrink: 1 }} numberOfLines={1}>
                    {name}
                  </Text>
                  {th.children.map((k) => (
                    <Dot key={k.id} colour={k.colour} />
                  ))}
                  {th.lastAt ? (
                    <Text style={{ marginLeft: 'auto', color: th.unread ? c.accent : c.muted, fontSize: 12, fontWeight: th.unread ? '700' : '400' }}>
                      {relative(th.lastAt, i18n.language)}
                    </Text>
                  ) : null}
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={{ color: th.unread ? c.ink : c.muted, fontSize: 14, flex: 1 }} numberOfLines={1}>
                    {th.lastSummary || th.lastTitle}
                  </Text>
                  {th.unread ? (
                    <Text style={{ minWidth: 22, textAlign: 'center', backgroundColor: c.lime, color: c.ink, fontSize: 12, fontWeight: '700', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 11, overflow: 'hidden' }}>
                      {th.unread}
                    </Text>
                  ) : null}
                </View>
              </View>
            </Pressable>
          );
        }}
      />
    </SafeAreaView>
  );
}
