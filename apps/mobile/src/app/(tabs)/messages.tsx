import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AskBar, Dot } from '@/components/Clases';
import { P } from '@/components/ui';
import { useThreads } from '@/lib/hooks';
import { inboxDate, niceSender } from '@/lib/inbox';
import { font, space, useTheme } from '@/lib/theme';

type Filter = 'all' | 'unread';

/**
 * Messages: an inbox like email. One row per sender (newest first); unread rows are bold with a
 * dot. Opening a row shows the conversation.
 */
export default function Messages() {
  const { t, i18n } = useTranslation();
  const c = useTheme();
  const threads = useThreads();
  const [filter, setFilter] = useState<Filter>('all');
  const all = threads.data ?? [];
  const unreadCount = all.filter((x) => x.unread).length;
  const list = filter === 'unread' ? all.filter((x) => x.unread) : all;

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: c.bg }}>
      <FlatList
        data={list}
        keyExtractor={(x) => x.key}
        contentContainerStyle={{ paddingHorizontal: space.xl, paddingBottom: space.xxl }}
        refreshControl={
          <RefreshControl
            refreshing={threads.isRefetching}
            onRefresh={() => void threads.refetch()}
            tintColor={c.accent}
          />
        }
        ListHeaderComponent={
          <View style={{ gap: 16, marginBottom: 12 }}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingTop: space.s,
              }}
            >
              <Text
                accessibilityRole="header"
                style={{ color: c.ink, fontSize: font.title, fontWeight: '700' }}
              >
                {t('cl.messages')}
              </Text>
              <Pressable
                onPress={() => router.push('/compose')}
                accessibilityRole="button"
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                  minHeight: 40,
                  paddingHorizontal: 14,
                  borderRadius: 20,
                  backgroundColor: pressed ? c.accentPressed : c.accent,
                })}
              >
                <Text style={{ color: '#FFFFFF', fontSize: 18, fontWeight: '700', marginTop: -2 }}>+</Text>
                <Text style={{ color: '#FFFFFF', fontSize: 14, fontWeight: '700' }}>
                  {t('cl.compose.newButton')}
                </Text>
              </Pressable>
            </View>
            <AskBar hint={t('cl.askMessages')} />
            <View accessibilityRole="tablist" style={{ flexDirection: 'row', gap: 8 }}>
              {(['all', 'unread'] as const).map((f) => (
                <Pressable
                  key={f}
                  onPress={() => setFilter(f)}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: filter === f }}
                  style={{
                    minHeight: 36,
                    paddingHorizontal: 14,
                    borderRadius: 18,
                    justifyContent: 'center',
                    backgroundColor: filter === f ? c.accent : c.card,
                    borderWidth: 1,
                    borderColor: filter === f ? c.accent : c.line,
                  }}
                >
                  <Text style={{ color: filter === f ? '#FFFFFF' : c.ink, fontWeight: '600', fontSize: 14 }}>
                    {f === 'all'
                      ? t('cl.all')
                      : `${t('cl.inbox.unread')}${unreadCount ? ` · ${unreadCount}` : ''}`}
                  </Text>
                </Pressable>
              ))}
            </View>
            {!threads.isLoading && !list.length ? (
              <P muted small>
                {filter === 'unread' && all.length ? t('cl.inbox.allRead') : t('cl.noMessages')}
              </P>
            ) : null}
          </View>
        }
        renderItem={({ item: th, index }) => {
          const name = th.sender ? niceSender(th.sender) : t('cl.school');
          const unread = th.unread > 0;
          const first = index === 0;
          const last = index === list.length - 1;
          return (
            <Pressable
              onPress={() => router.push({ pathname: '/thread/[key]', params: { key: th.key } })}
              accessibilityRole="button"
              accessibilityLabel={`${name}${unread ? `, ${t('cl.unread', { count: th.unread })}` : ''}`}
              style={({ pressed }) => ({
                flexDirection: 'row',
                gap: 10,
                paddingVertical: 14,
                paddingRight: 14,
                paddingLeft: 10,
                backgroundColor: pressed ? c.accentSoft : unread ? c.card : c.bg,
                borderColor: c.line,
                borderLeftWidth: 1,
                borderRightWidth: 1,
                borderTopWidth: 1,
                borderBottomWidth: last ? 1 : 0,
                borderTopLeftRadius: first ? 16 : 0,
                borderTopRightRadius: first ? 16 : 0,
                borderBottomLeftRadius: last ? 16 : 0,
                borderBottomRightRadius: last ? 16 : 0,
              })}
            >
              <View style={{ width: 10, paddingTop: 7, alignItems: 'center' }}>
                {unread ? (
                  <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: c.accent }} />
                ) : null}
              </View>
              <View style={{ flex: 1, gap: 3 }}>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10 }}>
                  <Text
                    style={{ flex: 1, color: c.ink, fontSize: 15, fontWeight: unread ? '700' : '500' }}
                    numberOfLines={1}
                  >
                    {name}
                  </Text>
                  <Text
                    numberOfLines={1}
                    style={{
                      flexShrink: 0,
                      color: unread ? c.accent : c.muted,
                      fontSize: 13,
                      fontWeight: unread ? '700' : '400',
                    }}
                  >
                    {inboxDate(th.lastAt, i18n.language)}
                  </Text>
                </View>
                <Text
                  style={{ color: c.ink, fontSize: 14, fontWeight: unread ? '700' : '400' }}
                  numberOfLines={1}
                >
                  {th.lastTitle}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={{ flex: 1, color: c.muted, fontSize: 13, lineHeight: 18 }} numberOfLines={2}>
                    {th.lastSummary}
                  </Text>
                  {th.children.map((k) => (
                    <Dot key={k.id} colour={k.colour} size={7} />
                  ))}
                  {th.count > 1 ? <Text style={{ color: c.muted, fontSize: 12 }}>{th.count}</Text> : null}
                </View>
              </View>
            </Pressable>
          );
        }}
      />
    </SafeAreaView>
  );
}
