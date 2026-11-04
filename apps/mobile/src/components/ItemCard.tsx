import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';
import type { FamilyAbsence, FeedItem } from '@/lib/api';
import { dayLabel, shortDate } from '@/lib/hooks';
import { font, space, useTheme } from '@/lib/theme';
import { Dot, Label } from './Clases';
import { Icon } from './Icon';

const open = (id: string) => router.push({ pathname: '/item/[id]', params: { id } });

/** An update in the stream: small type label, child, when, title, one-line summary. */
export function ItemCard({ item }: { item: FeedItem }) {
  const { t, i18n } = useTranslation();
  const c = useTheme();
  return (
    <Pressable
      onPress={() => open(item.id)}
      accessibilityRole="button"
      style={({ pressed }) => ({
        backgroundColor: c.card,
        borderWidth: 1,
        borderColor: pressed ? c.accent : c.line,
        borderRadius: 16,
        paddingVertical: 14,
        paddingHorizontal: space.l,
        gap: 6,
      })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Label text={t(`sections.${item.section}` as 'sections.other')} />
        <Dot colour={item.child?.colour} />
        <Text style={{ color: c.ink, fontSize: font.tiny, fontWeight: '600' }}>{item.child?.name ?? t('cl.family')}</Text>
        {item.postedAt ? (
          <Text style={{ marginLeft: 'auto', color: c.muted, fontSize: font.tiny }}>{shortDate(item.postedAt, i18n.language)}</Text>
        ) : null}
      </View>
      <Text style={{ color: c.ink, fontSize: font.body, fontWeight: item.read ? '600' : '700', lineHeight: 21 }} numberOfLines={2}>
        {item.title}
      </Text>
      {item.summary ? (
        <Text style={{ color: c.muted, fontSize: font.small, lineHeight: 20 }} numberOfLines={2}>
          {item.summary}
        </Text>
      ) : null}
    </Pressable>
  );
}

/** A "Needs you" card: who, what kind, the ask, the deadline, one button. */
export function NeedsCard({ item }: { item: FeedItem }) {
  const { t, i18n } = useTranslation();
  const c = useTheme();
  const kind = item.action?.kind ?? 'open';
  const due = item.action?.deadlineAt;
  const actLabel = t(`cl.act.${kind}` as 'cl.act.open', { defaultValue: t('cl.act.open') });
  return (
    <Pressable
      onPress={() => open(item.id)}
      accessibilityRole="button"
      accessibilityHint={actLabel}
      style={({ pressed }) => ({ backgroundColor: c.card, borderWidth: 1, borderColor: pressed ? c.accent : c.line, borderRadius: 16, padding: space.l, gap: 10 })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Dot colour={item.child?.colour} />
        <Text style={{ color: c.ink, fontSize: 13, fontWeight: '600' }}>{item.child?.name ?? t('cl.family')}</Text>
        <Text style={{ color: c.muted }}>·</Text>
        <Label text={t(`sections.${item.section}` as 'sections.other')} tone="plain" />
      </View>
      <Text style={{ color: c.ink, fontSize: 17, fontWeight: '700', lineHeight: 22 }}>{item.summary || item.title}</Text>
      {due ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Icon name="clock" size={14} color={c.warn} />
          <Text style={{ color: c.warn, fontSize: 13, fontWeight: '700' }}>{t('cl.due', { date: shortDate(due, i18n.language) })}</Text>
        </View>
      ) : null}
      {/* Visual button only: the whole card is the one tap target (no nested buttons on web). */}
      <View style={{ minHeight: 46, borderRadius: 12, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: '#FFFFFF', fontSize: 15, fontWeight: '700' }}>{actLabel}</Text>
      </View>
    </Pressable>
  );
}

/** "Needs you" card for an absence GestIB still has no reason for. Opens the child's attendance. */
export function AbsenceCard({ a }: { a: FamilyAbsence }) {
  const { t, i18n } = useTranslation();
  const c = useTheme();
  const go = () => router.push({ pathname: '/child/[id]', params: { id: a.child.id, tab: 'attendance' } });
  return (
    <Pressable
      onPress={go}
      accessibilityRole="button"
      style={({ pressed }) => ({ backgroundColor: c.card, borderWidth: 1, borderColor: pressed ? c.accent : c.line, borderRadius: 16, padding: space.l, gap: 10 })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Dot colour={a.child.colour} />
        <Text style={{ color: c.ink, fontSize: 13, fontWeight: '600' }}>{a.child.name}</Text>
        <Text style={{ color: c.muted }}>·</Text>
        <Label text={t('cl.child.attendance')} tone="plain" />
      </View>
      <Text style={{ color: c.ink, fontSize: 17, fontWeight: '700', lineHeight: 22 }}>
        {t('cl.absenceTitle', { date: dayLabel(a.day, i18n.language) })}
      </Text>
      {a.period || a.subject ? (
        <Text style={{ color: c.muted, fontSize: 13 }}>{[a.period ? t('cl.child.period', { p: a.period }) : null, a.subject].filter(Boolean).join(' · ')}</Text>
      ) : null}
      <View style={{ minHeight: 46, borderRadius: 12, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: '#FFFFFF', fontSize: 15, fontWeight: '700' }}>{t('cl.act.justify_absence')}</Text>
      </View>
    </Pressable>
  );
}
