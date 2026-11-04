import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';
import { Card, Chip, H1, P, Row, Screen } from '@/components/ui';
import { api, type CalendarEntry } from '@/lib/api';
import { shortDate } from '@/lib/hooks';
import { font, radius, space, useTheme } from '@/lib/theme';

const ymd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(d);

/** SPEC §11 screen 10: month / agenda, colour per child, deadlines and events. */
export default function Calendar() {
  const { t, i18n } = useTranslation();
  const c = useTheme();
  const [mode, setMode] = useState<'agenda' | 'month'>('agenda');
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const from = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const to = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  const q = useQuery({
    queryKey: ['calendar', from.toISOString()],
    queryFn: () => api<CalendarEntry[]>(`/calendar?from=${from.toISOString()}&to=${to.toISOString()}`),
  });
  const byDay = useMemo(() => {
    const m = new Map<string, CalendarEntry[]>();
    for (const e of q.data ?? [])
      m.set(ymd(new Date(e.startsAt)), [...(m.get(ymd(new Date(e.startsAt))) ?? []), e]);
    return m;
  }, [q.data]);
  const title = new Intl.DateTimeFormat(i18n.language, { month: 'long', year: 'numeric' }).format(cursor);

  const days: (Date | null)[] = [];
  const lead = (from.getDay() + 6) % 7; // Monday first
  for (let i = 0; i < lead; i++) days.push(null);
  for (let d = 1; d <= new Date(to.getTime() - 1).getDate(); d++)
    days.push(new Date(cursor.getFullYear(), cursor.getMonth(), d));
  const today = ymd(new Date());

  return (
    <Screen>
      <H1>{t('tabs.calendar')}</H1>
      <Row style={{ justifyContent: 'space-between' }}>
        <Row>
          <Chip label={t('cal.agenda')} active={mode === 'agenda'} onPress={() => setMode('agenda')} />
          <Chip label={t('cal.month')} active={mode === 'month'} onPress={() => setMode('month')} />
        </Row>
        <Row>
          <Chip
            label="‹"
            onPress={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
          />
          <Chip
            label="›"
            onPress={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
          />
        </Row>
      </Row>
      <Text style={{ color: c.ink, fontSize: font.h2, fontWeight: '600', textTransform: 'capitalize' }}>
        {title}
      </Text>

      {mode === 'month' ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {days.map((d, i) => {
            const key = d ? ymd(d) : `x${i}`;
            const ev = d ? (byDay.get(key) ?? []) : [];
            return (
              <View key={key} style={{ width: `${100 / 7}%`, aspectRatio: 1, padding: 2 }}>
                {d ? (
                  <View
                    style={{
                      flex: 1,
                      borderRadius: radius.s,
                      backgroundColor: key === today ? c.accentSoft : c.card,
                      alignItems: 'center',
                      paddingTop: 4,
                      gap: 3,
                    }}
                  >
                    <Text style={{ color: c.ink, fontSize: font.small }}>{d.getDate()}</Text>
                    <Row style={{ gap: 2 }}>
                      {ev.slice(0, 3).map((e) => (
                        <View
                          key={e.id}
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: 3,
                            backgroundColor: e.child?.colour ?? c.warn,
                          }}
                        />
                      ))}
                    </Row>
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      ) : null}

      {!q.data?.length && !q.isLoading ? <P muted>{t('cal.empty')}</P> : null}
      {(q.data ?? []).map((e) => (
        <Card
          key={e.id}
          accent={e.child?.colour ?? c.warn}
          onPress={
            e.itemId ? () => router.push({ pathname: '/item/[id]', params: { id: e.itemId! } }) : undefined
          }
        >
          <Row style={{ justifyContent: 'space-between' }}>
            <P small muted>
              {shortDate(e.startsAt, i18n.language)}
            </P>
            {e.child?.name ? (
              <P small muted>
                {e.child.name}
              </P>
            ) : null}
          </Row>
          <P>{`${e.kind === 'deadline' ? '⏰ ' : e.kind === 'school' ? '🏖️ ' : e.kind === 'event' ? '📅 ' : ''}${e.title}`}</P>
        </Card>
      ))}
      <Pressable onPress={() => setCursor(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}>
        <Text style={{ color: c.accent, fontWeight: '600', textAlign: 'center', padding: space.s }}>
          {t('cal.today')}
        </Text>
      </Pressable>
    </Screen>
  );
}
