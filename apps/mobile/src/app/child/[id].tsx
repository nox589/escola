import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, TextInput, View } from 'react-native';
import { BackLink } from '@/components/Clases';
import { Icon } from '@/components/Icon';
import { ItemCard } from '@/components/ItemCard';
import { P, Screen } from '@/components/ui';
import { api, type FeedItem } from '@/lib/api';
import { shortDate, useChildren } from '@/lib/hooks';
import { font, onColour, space, useTheme } from '@/lib/theme';

interface Doc {
  id: string;
  filename: string;
  item: { id: string; title: string; postedAt: string | null; childId: string | null };
}
type Tab = 'updates' | 'documents' | 'grades' | 'attendance';

/** A child's page: short summary, then updates, documents, grades and attendance. */
export default function ChildPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, i18n } = useTranslation();
  const c = useTheme();
  const kids = useChildren();
  const kid = kids.data?.find((k) => k.id === id);
  const [tab, setTab] = useState<Tab>('updates');
  const [q, setQ] = useState('');

  const items = useQuery({
    queryKey: ['items', 'child', id],
    queryFn: () => api<{ items: FeedItem[] }>(`/items?limit=60&child_id=${id}`),
  });
  const docs = useQuery({
    queryKey: ['docs', q, id],
    queryFn: () => api<Doc[]>(`/attachments?${new URLSearchParams({ child_id: id!, ...(q ? { q } : {}) })}`),
    enabled: tab === 'documents',
  });
  const open = async (docId: string) => {
    const { url } = await api<{ url: string }>(`/attachments/${docId}/url`);
    await WebBrowser.openBrowserAsync(url);
  };

  const all = items.data?.items ?? [];
  const mine = all.filter((i) => i.child?.id === id);
  const monthAgo = Date.now() - 30 * 86400_000;
  const recent = all.filter((i) => i.postedAt && new Date(i.postedAt).getTime() > monthAgo).length;
  const actions = all.filter((i) => i.action).length;

  const tabs: { id: Tab; label: string }[] = [
    { id: 'updates', label: t('cl.child.updates') },
    { id: 'documents', label: t('cl.child.documents') },
    { id: 'grades', label: t('cl.child.grades') },
    { id: 'attendance', label: t('cl.child.attendance') },
  ];

  return (
    <Screen>
      <BackLink label={t('cl.today')} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: kid?.colour ?? c.accent, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: onColour(kid?.colour), fontSize: 24, fontWeight: '700' }}>{kid?.displayName?.[0] ?? ''}</Text>
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text accessibilityRole="header" style={{ color: c.ink, fontSize: font.title, fontWeight: '700' }}>{kid?.displayName ?? ''}</Text>
          {kid?.classLabel || kid?.schoolName ? (
            <Text style={{ color: c.mutedOnBg, fontSize: font.small }}>{[kid?.classLabel, kid?.schoolName].filter(Boolean).join(' · ')}</Text>
          ) : null}
        </View>
      </View>

      <View style={{ backgroundColor: c.accentSoft, borderRadius: 16, padding: 14, gap: 4 }}>
        <Text style={{ fontSize: 11, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase', color: c.accent }}>{t('cl.child.inShort')}</Text>
        <Text style={{ color: c.ink, fontSize: 17, fontWeight: '600', lineHeight: 23 }}>
          {t('cl.child.summary', { actions, updates: recent })}
        </Text>
      </View>

      <View accessibilityRole="tablist" style={{ flexDirection: 'row', gap: 4, backgroundColor: c.card, borderWidth: 1, borderColor: c.line, borderRadius: 14, padding: 4 }}>
        {tabs.map((x) => (
          <Pressable
            key={x.id}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === x.id }}
            onPress={() => setTab(x.id)}
            style={{ flex: 1, minHeight: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: tab === x.id ? c.accent : 'transparent' }}
          >
            <Text style={{ color: tab === x.id ? '#FFFFFF' : c.ink, fontWeight: '600', fontSize: 13 }}>{x.label}</Text>
          </Pressable>
        ))}
      </View>

      {tab === 'updates' ? (
        <View style={{ gap: 10 }}>
          {!items.isLoading && !mine.length ? <P muted small>{t('cl.child.noUpdates')}</P> : null}
          {mine.map((i) => (
            <ItemCard key={i.id} item={i} />
          ))}
        </View>
      ) : null}

      {tab === 'documents' ? (
        <View style={{ gap: 10 }}>
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder={t('cl.child.searchDocs')}
            placeholderTextColor={c.muted}
            accessibilityLabel={t('cl.child.searchDocs')}
            style={{ minHeight: 46, borderWidth: 1, borderColor: c.line, borderRadius: 12, backgroundColor: c.card, paddingHorizontal: 14, fontSize: 15, color: c.ink }}
          />
          {!docs.isLoading && !docs.data?.length ? <P muted small>{t('cl.child.noDocs')}</P> : null}
          {(docs.data ?? []).map((d) => (
            <Pressable
              key={d.id}
              onPress={() => void open(d.id)}
              accessibilityRole="link"
              style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: c.card, borderWidth: 1, borderColor: c.line, borderRadius: 14, padding: 12 }}
            >
              <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="file" size={18} color={c.accent} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ color: c.ink, fontSize: 15, fontWeight: '600' }} numberOfLines={1}>{d.filename}</Text>
                <Text style={{ color: c.muted, fontSize: 12 }} numberOfLines={1}>
                  {[d.item.title, d.item.postedAt ? shortDate(d.item.postedAt, i18n.language) : null].filter(Boolean).join(' · ')}
                </Text>
              </View>
            </Pressable>
          ))}
        </View>
      ) : null}

      {tab === 'grades' ? <P muted small>{t('cl.child.gradesEmpty')}</P> : null}
      {tab === 'attendance' ? <P muted small>{t('cl.child.attendanceEmpty')}</P> : null}
      <View style={{ height: space.l }} />
    </Screen>
  );
}
