import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';
import { api, type CalendarEntry } from '@/lib/api';
import { firstName } from '@/lib/todo';
import { useTheme } from '@/lib/theme';
import { Dot } from './Clases';

export type Period = 'current' | 'past';

/** Two-way switch: what matters now vs everything that has passed. */
export function PeriodToggle({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  const { t } = useTranslation();
  const c = useTheme();
  return (
    <View
      accessibilityRole="tablist"
      style={{
        flexDirection: 'row',
        gap: 4,
        backgroundColor: c.card,
        borderWidth: 1,
        borderColor: c.line,
        borderRadius: 14,
        padding: 4,
      }}
    >
      {(['current', 'past'] as const).map((p) => (
        <Pressable
          key={p}
          onPress={() => onChange(p)}
          accessibilityRole="tab"
          accessibilityState={{ selected: value === p }}
          style={{
            flex: 1,
            minHeight: 38,
            borderRadius: 10,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: value === p ? c.accent : 'transparent',
          }}
        >
          <Text style={{ color: value === p ? '#FFFFFF' : c.ink, fontWeight: '700', fontSize: 14 }}>
            {t(`cl.period.${p}`)}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

/** The next things on the calendar (not holidays), most imminent first. */
export function ComingUp({
  childId,
  limit = 4,
  days = 21,
}: {
  childId?: string;
  limit?: number;
  days?: number;
}) {
  const { t, i18n } = useTranslation();
  const c = useTheme();
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  const to = new Date(from.getTime() + days * 86_400_000);
  const q = useQuery({
    queryKey: ['calendar', 'comingUp', childId ?? 'all', from.toISOString().slice(0, 10)],
    queryFn: () =>
      api<CalendarEntry[]>(
        `/calendar?from=${from.toISOString()}&to=${to.toISOString()}${childId ? `&child_id=${childId}` : ''}`,
      ),
  });
  const list = (q.data ?? []).filter((e) => e.kind !== 'school').slice(0, limit);
  if (!list.length) return null;
  const loc = i18n.language === 'en' ? 'en-GB' : i18n.language;
  return (
    <View style={{ gap: 8 }}>
      <Text accessibilityRole="header" style={{ color: c.ink, fontSize: 17, fontWeight: '700' }}>
        {t('cl.child.upcoming')}
      </Text>
      {list.map((e) => (
        <Pressable
          key={e.id}
          disabled={!e.itemId}
          onPress={() => e.itemId && router.push({ pathname: '/item/[id]', params: { id: e.itemId } })}
          accessibilityRole={e.itemId ? 'link' : undefined}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            backgroundColor: c.card,
            borderWidth: 1,
            borderColor: c.line,
            borderRadius: 14,
            paddingVertical: 10,
            paddingHorizontal: 12,
          }}
        >
          <View style={{ width: 46, alignItems: 'center' }}>
            <Text style={{ color: c.accent, fontSize: 12, fontWeight: '700', textTransform: 'uppercase' }}>
              {new Intl.DateTimeFormat(loc, { month: 'short', timeZone: 'Europe/Madrid' }).format(
                new Date(e.startsAt),
              )}
            </Text>
            <Text style={{ color: c.ink, fontSize: 20, fontWeight: '700' }}>
              {new Intl.DateTimeFormat(loc, { day: 'numeric', timeZone: 'Europe/Madrid' }).format(
                new Date(e.startsAt),
              )}
            </Text>
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ color: c.ink, fontSize: 15, fontWeight: '600' }} numberOfLines={2}>
              {e.title}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Dot colour={e.child?.colour} size={6} />
              <Text style={{ color: c.muted, fontSize: 12 }}>
                {e.child?.name ? firstName(e.child.name) : t('cl.family')} ·{' '}
                {t(`cl.kinds.${e.kind}`, { defaultValue: e.kind })}
              </Text>
            </View>
          </View>
        </Pressable>
      ))}
    </View>
  );
}
