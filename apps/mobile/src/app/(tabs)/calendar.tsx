import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AskBar, Dot } from '@/components/Clases';
import { Icon } from '@/components/Icon';
import { P } from '@/components/ui';
import { api, type CalendarEntry } from '@/lib/api';
import { useChildren, useProfiles } from '@/lib/hooks';
import { font, space, useTheme } from '@/lib/theme';

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const madridYmd = (iso: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date(iso));
function mondayOf(d: Date) {
  const m = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
  return m;
}

/** Week: a strip of seven days with each child's colour, then what happens each day. */
export default function Week() {
  const { t, i18n } = useTranslation();
  const c = useTheme();
  const kids = useChildren();
  const [offset, setOffset] = useState(0);
  const [day, setDay] = useState<string | null>(null);
  const loc = i18n.language === 'en' ? 'en-GB' : i18n.language;

  const start = useMemo(() => {
    const m = mondayOf(new Date());
    m.setDate(m.getDate() + offset * 7);
    return m;
  }, [offset]);
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);
  const days = Array.from(
    { length: 7 },
    (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i),
  );
  const todayKey = ymd(new Date());

  const week = useQuery({
    queryKey: ['calendar', 'week', ymd(start)],
    queryFn: () => api<CalendarEntry[]>(`/calendar?from=${start.toISOString()}&to=${end.toISOString()}`),
  });
  const ahead = useQuery({
    queryKey: ['calendar', 'ahead'],
    queryFn: () => {
      const from = new Date();
      const to = new Date(Date.now() + 150 * 86400_000);
      return api<CalendarEntry[]>(`/calendar?from=${from.toISOString()}&to=${to.toISOString()}`);
    },
  });

  const profiles = useProfiles((kids.data ?? []).map((k) => k.id));
  /** Per-child class span for a date (none on school days off). */
  const classesOn = (d: Date) => {
    const wd = ((d.getDay() + 6) % 7) + 1;
    if ((byDay.get(ymd(d)) ?? []).some((e) => e.kind === 'school')) return [];
    return profiles
      .map((q) => q.data)
      .filter((p): p is NonNullable<typeof p> => !!p)
      .map((p) => {
        const s = p.timetable.filter((x) => x.day === wd).sort((a, b) => a.start.localeCompare(b.start));
        return s.length
          ? {
              id: p.id,
              name: p.displayName,
              colour: p.colour,
              count: s.length,
              from: s[0]!.start,
              to: s[s.length - 1]!.end,
            }
          : null;
      })
      .filter((x): x is NonNullable<typeof x> => !!x);
  };
  const colourOf = (e: CalendarEntry) =>
    e.child?.colour ?? kids.data?.find((k) => k.id === e.childId)?.colour ?? null;
  const byDay = new Map<string, CalendarEntry[]>();
  for (const e of week.data ?? []) {
    const k = madridYmd(e.startsAt);
    byDay.set(k, [...(byDay.get(k) ?? []), e]);
  }

  // School-calendar days off ahead, collapsed into ranges ("Christmas holidays: 22 Dec to 7 Jan").
  const comingUp = useMemo(() => {
    const school = (ahead.data ?? [])
      .filter((e) => e.kind === 'school')
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    const out: { title: string; from: string; to: string }[] = [];
    for (const e of school) {
      const last = out[out.length - 1];
      const d = madridYmd(e.startsAt);
      if (
        last &&
        last.title === e.title &&
        (new Date(d).getTime() - new Date(last.to).getTime()) / 86400_000 <= 3
      )
        last.to = d;
      else out.push({ title: e.title, from: d, to: d });
    }
    return out.slice(0, 5);
  }, [ahead.data]);
  const fmt = (d: string) =>
    new Intl.DateTimeFormat(loc, { weekday: 'short', day: 'numeric', month: 'short' }).format(
      new Date(`${d}T12:00:00`),
    );

  const shown = days
    .filter((d) => (day ? ymd(d) === day : true))
    .filter((d) => byDay.get(ymd(d))?.length || classesOn(d).length);
  const kindLabel = (k: string) => t(`cl.kinds.${k}` as 'cl.kinds.event', { defaultValue: k });
  const kindColour = (k: string) =>
    k === 'deadline' ? c.warn : k === 'school' ? c.success : k === 'evaluation' ? '#6B5B95' : c.accent;

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView contentContainerStyle={{ padding: space.xl, gap: 16, paddingBottom: space.xxl }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingTop: space.s,
          }}
        >
          <Text accessibilityRole="header" style={{ color: c.ink, fontSize: font.title, fontWeight: '700' }}>
            {offset === 0
              ? t('cl.thisWeek')
              : `${days[0]!.getDate()}–${days[6]!.getDate()} ${new Intl.DateTimeFormat(loc, { month: 'short' }).format(days[6]!)}`}
          </Text>
          <View style={{ flexDirection: 'row', gap: 4 }}>
            <Pressable
              accessibilityLabel={t('cl.prevWeek')}
              onPress={() => {
                setOffset(offset - 1);
                setDay(null);
              }}
              style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
            >
              <Icon name="back" color={c.ink} />
            </Pressable>
            <Pressable
              accessibilityLabel={t('cl.nextWeek')}
              onPress={() => {
                setOffset(offset + 1);
                setDay(null);
              }}
              style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
            >
              <Icon name="chevron" color={c.ink} />
            </Pressable>
          </View>
        </View>

        <AskBar hint={t('cl.askWeek')} />

        <View
          style={{
            flexDirection: 'row',
            gap: 4,
            backgroundColor: c.card,
            borderWidth: 1,
            borderColor: c.line,
            borderRadius: 16,
            padding: 8,
          }}
        >
          {days.map((d) => {
            const k = ymd(d);
            const entries = byDay.get(k) ?? [];
            const sel = day === k;
            const isToday = k === todayKey;
            const colours = [
              ...new Set(entries.filter((e) => e.kind !== 'school').map((e) => colourOf(e) ?? c.line)),
            ].slice(0, 3);
            const off = entries.some((e) => e.kind === 'school');
            return (
              <Pressable
                key={k}
                onPress={() => setDay(sel ? null : k)}
                accessibilityRole="button"
                accessibilityState={{ selected: sel }}
                style={{
                  flex: 1,
                  minHeight: 66,
                  borderRadius: 12,
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 3,
                  backgroundColor: sel ? c.accent : isToday ? c.accentSoft : 'transparent',
                }}
              >
                <Text style={{ fontSize: 11, fontWeight: '600', color: sel ? '#FFFFFF' : c.muted }}>
                  {new Intl.DateTimeFormat(loc, { weekday: 'short' }).format(d)}
                </Text>
                <Text
                  style={{
                    fontSize: 18,
                    fontWeight: '700',
                    color: sel ? '#FFFFFF' : off ? c.success : c.ink,
                  }}
                >
                  {d.getDate()}
                </Text>
                <View style={{ flexDirection: 'row', gap: 3, height: 6 }}>
                  {colours.map((col) => (
                    <Dot key={col} colour={col} size={6} />
                  ))}
                </View>
              </Pressable>
            );
          })}
        </View>
        {day ? (
          <Pressable onPress={() => setDay(null)} style={{ alignSelf: 'flex-end', minHeight: 32 }}>
            <Text style={{ color: c.accent, fontWeight: '700' }}>{t('cl.showWeek')}</Text>
          </Pressable>
        ) : null}

        {!week.isLoading && !shown.length ? (
          <P muted small>
            {t('cl.nothingWeek')}
          </P>
        ) : null}
        {shown.map((d) => (
          <View key={ymd(d)} style={{ gap: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text accessibilityRole="header" style={{ color: c.ink, fontSize: 15, fontWeight: '700' }}>
                {new Intl.DateTimeFormat(loc, { weekday: 'long', day: 'numeric' }).format(d)}
              </Text>
              {ymd(d) === todayKey ? (
                <Text
                  style={{
                    fontSize: 11,
                    fontWeight: '700',
                    backgroundColor: c.lime,
                    color: c.ink,
                    paddingHorizontal: 8,
                    paddingVertical: 2,
                    borderRadius: 8,
                    overflow: 'hidden',
                  }}
                >
                  {t('cl.today').toUpperCase()}
                </Text>
              ) : null}
            </View>
            {classesOn(d).map((k) => (
              <Pressable
                key={`cls-${k.id}`}
                onPress={() =>
                  router.push({ pathname: '/child/[id]', params: { id: k.id, tab: 'timetable' } })
                }
                accessibilityRole="link"
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 8,
                  paddingHorizontal: 4,
                  minHeight: 32,
                }}
              >
                <Dot colour={k.colour} size={6} />
                <Text style={{ color: c.mutedOnBg, fontSize: 13 }}>
                  <Text style={{ fontWeight: '600', color: c.ink }}>{k.name}</Text>
                  {`  ${t('cl.classes', { count: k.count, from: k.from, to: k.to })}`}
                </Text>
              </Pressable>
            ))}
            {(byDay.get(ymd(d)) ?? []).map((e) => (
              <Pressable
                key={e.id}
                disabled={!e.itemId}
                onPress={() => e.itemId && router.push({ pathname: '/item/[id]', params: { id: e.itemId } })}
                style={{
                  backgroundColor: e.kind === 'school' ? c.accentSoft : c.card,
                  borderWidth: e.kind === 'school' ? 0 : 1,
                  borderColor: c.line,
                  borderRadius: 14,
                  paddingVertical: 12,
                  paddingHorizontal: 14,
                  gap: 6,
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Dot colour={e.kind === 'school' ? c.success : colourOf(e)} />
                  <Text style={{ color: c.ink, fontSize: 12, fontWeight: '600' }}>
                    {e.child?.name ?? t('cl.family')}
                  </Text>
                  <Text
                    style={{
                      fontSize: 11,
                      fontWeight: '700',
                      letterSpacing: 0.6,
                      textTransform: 'uppercase',
                      color: kindColour(e.kind),
                    }}
                  >
                    {kindLabel(e.kind)}
                  </Text>
                </View>
                <Text style={{ color: c.ink, fontSize: 15, fontWeight: '600', lineHeight: 20 }}>
                  {e.title}
                </Text>
              </Pressable>
            ))}
          </View>
        ))}

        {comingUp.length ? (
          <View style={{ gap: 8 }}>
            <Text accessibilityRole="header" style={{ color: c.ink, fontSize: 15, fontWeight: '700' }}>
              {t('cl.comingUp')}
            </Text>
            <View style={{ backgroundColor: c.accentSoft, borderRadius: 14, padding: 14, gap: 10 }}>
              {comingUp.map((r) => (
                <View
                  key={r.from + r.title}
                  style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}
                >
                  <Text style={{ color: c.ink, fontSize: 14, flex: 1 }}>{r.title}</Text>
                  <Text style={{ color: c.ink, fontSize: 14, fontWeight: '700' }}>
                    {r.from === r.to ? fmt(r.from) : `${fmt(r.from)} – ${fmt(r.to)}`}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
