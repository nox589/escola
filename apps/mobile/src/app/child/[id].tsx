import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { CallSchoolButton } from '@/components/CallSchool';
import { BackLink } from '@/components/Clases';
import { Icon } from '@/components/Icon';
import { AbsenceCard, ItemCard, NeedsCard } from '@/components/ItemCard';
import { ComingUp, type Period, PeriodToggle } from '@/components/Period';
import { P, Screen } from '@/components/ui';
import {
  api,
  type Absence,
  type ChildProfile,
  type FamilyAbsence,
  type FeedItem,
  type TimetableSession,
} from '@/lib/api';
import {
  dayLabel,
  relative,
  shortDate,
  subjectOf,
  useAbsences,
  useChildProfile,
  useChildren,
  weekdayName,
} from '@/lib/hooks';
import { isCurrent, sortTodos } from '@/lib/todo';
import { font, onColour, space, useTheme } from '@/lib/theme';

interface Doc {
  id: string;
  filename: string;
  title?: string;
  item: { id: string; title: string; postedAt: string | null; childId: string | null };
}
type Tab = 'updates' | 'timetable' | 'attendance' | 'documents' | 'grades';
const TABS: Tab[] = ['updates', 'timetable', 'attendance', 'documents', 'grades'];

/** Madrid weekday (1 = Monday ... 7 = Sunday) and HH:MM right now. */
function madridNow() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Madrid',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const wd = parts.find((p) => p.type === 'weekday')?.value ?? 'Mon';
  const day = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(wd) + 1;
  const hh = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const mm = parts.find((p) => p.type === 'minute')?.value ?? '00';
  return { day, time: `${hh === '24' ? '00' : hh}:${mm}` };
}

/** The next class from now: later today, else the first class of the next school day. */
function nextClass(tt: TimetableSession[]) {
  if (!tt.length) return null;
  const { day, time } = madridNow();
  const later = tt
    .filter((s) => s.day === day && s.start > time)
    .sort((a, b) => a.start.localeCompare(b.start))[0];
  if (later) return { s: later, today: true };
  for (let i = 1; i <= 7; i++) {
    const d = ((day - 1 + i) % 7) + 1;
    const first = tt.filter((s) => s.day === d).sort((a, b) => a.start.localeCompare(b.start))[0];
    if (first) return { s: first, today: false };
  }
  return null;
}

/** A child's page: profile (teachers, next class, absences), then updates, timetable, attendance, documents, grades. */
export default function ChildPage() {
  const { id, tab: tabParam } = useLocalSearchParams<{ id: string; tab?: string }>();
  const { t, i18n } = useTranslation();
  const c = useTheme();
  const kids = useChildren();
  const kid = kids.data?.find((k) => k.id === id);
  const profile = useChildProfile(id);
  const [tab, setTab] = useState<Tab>(TABS.includes(tabParam as Tab) ? (tabParam as Tab) : 'updates');
  const [q, setQ] = useState('');
  const [allTeachers, setAllTeachers] = useState(false);
  const [period, setPeriod] = useState<Period>('current');
  const familyAbsences = useAbsences();

  const items = useQuery({
    queryKey: ['items', 'child', id],
    queryFn: () => api<{ items: FeedItem[] }>(`/items?limit=60&child_id=${id}`),
  });
  const docs = useQuery({
    queryKey: ['docs', q, id],
    queryFn: () => api<Doc[]>(`/attachments?${new URLSearchParams({ child_id: id!, ...(q ? { q } : {}) })}`),
    enabled: tab === 'documents',
  });
  const open = (docId: string, name: string, file: string) =>
    router.push({ pathname: '/doc/[id]', params: { id: docId, name, file } });

  const p = profile.data;
  const all = items.data?.items ?? [];
  const monthAgo = Date.now() - 30 * 86400_000;
  const recent = all.filter((i) => i.postedAt && new Date(i.postedAt).getTime() > monthAgo).length;
  const needs = all.filter((i) => i.action && isCurrent(i));
  const actions = needs.length;
  const updates = all.filter((i) => !i.action && i.section !== 'message' && isCurrent(i));
  const past = all.filter((i) => !isCurrent(i));
  const openAbsences: FamilyAbsence[] = (familyAbsences.data ?? []).filter(
    (a) => a.status === 'unjustified' && a.child.id === id,
  );
  const todos = sortTodos([
    ...needs.map((item) => ({ kind: 'item' as const, item })),
    ...openAbsences.map((a) => ({ kind: 'absence' as const, a })),
  ]);
  const absences = p?.absences ?? [];
  const openAbs = absences.filter((a) => a.status === 'unjustified').length;
  const next = useMemo(() => nextClass(p?.timetable ?? []), [p?.timetable]);
  const nextEvent = p?.upcoming[0];

  const tabLabel: Record<Tab, string> = {
    updates: t('cl.child.updates'),
    timetable: t('cl.child.timetable'),
    attendance: t('cl.child.attendance'),
    documents: t('cl.child.documents'),
    grades: t('cl.child.grades'),
  };
  const teachers = p?.teachers ?? [];
  const shownTeachers = allTeachers ? teachers : teachers.slice(0, 3);
  // Subject names in the UI language for the teacher list.
  const subjName = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of p?.timetable ?? []) m.set(s.subject, subjectOf(s));
    return m;
  }, [p?.timetable]);

  const Line = ({
    icon,
    text,
    tone,
  }: {
    icon: 'clock' | 'calendar' | 'check' | 'alert';
    text: string;
    tone?: string;
  }) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Icon name={icon} size={16} color={tone ?? c.accent} />
      <Text style={{ color: c.ink, fontSize: font.small, flex: 1, lineHeight: 20 }}>{text}</Text>
    </View>
  );

  return (
    <Screen>
      <BackLink label={t('cl.today')} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <View
          style={{
            width: 56,
            height: 56,
            borderRadius: 28,
            backgroundColor: kid?.colour ?? c.accent,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ color: onColour(kid?.colour), fontSize: 24, fontWeight: '700' }}>
            {kid?.displayName?.[0] ?? ''}
          </Text>
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text accessibilityRole="header" style={{ color: c.ink, fontSize: font.title, fontWeight: '700' }}>
            {kid?.displayName ?? ''}
          </Text>
          {kid?.classLabel ? (
            <Text style={{ color: c.mutedOnBg, fontSize: font.small }}>{kid.classLabel}</Text>
          ) : null}
        </View>
        {kid ? <CallSchoolButton kids={[kid]} /> : null}
      </View>

      <SchoolCard
        name={kid?.schoolName ?? null}
        classLabel={kid?.classLabel ?? null}
        phone={kid?.schoolPhone ?? null}
        childId={id!}
      />

      <View style={{ backgroundColor: c.accentSoft, borderRadius: 16, padding: 14, gap: 8 }}>
        <Text
          style={{
            fontSize: 11,
            fontWeight: '700',
            letterSpacing: 0.6,
            textTransform: 'uppercase',
            color: c.accent,
          }}
        >
          {t('cl.child.inShort')}
        </Text>
        <Text style={{ color: c.ink, fontSize: 17, fontWeight: '600', lineHeight: 23 }}>
          {t('cl.child.summary', { actions, updates: recent })}
        </Text>
        {next ? (
          <Line
            icon="clock"
            text={t('cl.child.nextUp', {
              subject: subjectOf(next.s),
              day: next.today ? t('cl.today').toLowerCase() : weekdayName(next.s.day, i18n.language),
              time: next.s.start,
            })}
          />
        ) : null}
        {p ? (
          <Line
            icon={openAbs ? 'alert' : 'check'}
            tone={openAbs ? c.warn : c.accent}
            text={
              !absences.length
                ? t('cl.child.absNone')
                : openAbs
                  ? t('cl.child.absShort', { count: absences.length, open: openAbs })
                  : t('cl.child.absShortAll', { count: absences.length })
            }
          />
        ) : null}
        {nextEvent ? (
          <Line
            icon="calendar"
            text={`${nextEvent.title} · ${shortDate(nextEvent.startsAt, i18n.language)}`}
          />
        ) : null}
      </View>

      {todos.length ? (
        <View style={{ gap: 10 }}>
          <Text accessibilityRole="header" style={{ color: c.ink, fontSize: 17, fontWeight: '700' }}>
            {t('cl.needsYou')}
          </Text>
          {todos.map((td) =>
            td.kind === 'item' ? (
              <NeedsCard key={td.item.id} item={td.item} />
            ) : (
              <AbsenceCard key={td.a.id} a={td.a} />
            ),
          )}
        </View>
      ) : null}

      <ComingUp childId={id} />

      <View
        style={{
          backgroundColor: c.card,
          borderWidth: 1,
          borderColor: c.line,
          borderRadius: 16,
          padding: 14,
          gap: 10,
        }}
      >
        <View style={{ gap: 2 }}>
          <Text accessibilityRole="header" style={{ color: c.ink, fontSize: 16, fontWeight: '700' }}>
            {t('cl.child.teachers')}
          </Text>
          <Text style={{ color: c.muted, fontSize: 12 }}>{t('cl.child.teachersHint')}</Text>
        </View>
        {p && !teachers.length ? (
          <P muted small>
            {t('cl.child.noTeachers')}
          </P>
        ) : null}
        {shownTeachers.map((x, i) => (
          <View key={x.name} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View
              style={{
                width: 36,
                height: 36,
                borderRadius: 18,
                backgroundColor: c.accentSoft,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={{ color: c.accent, fontWeight: '700' }}>{x.name.trim()[0] ?? ''}</Text>
            </View>
            <View style={{ flex: 1, gap: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <Text style={{ color: c.ink, fontSize: 15, fontWeight: '600' }}>{x.name}</Text>
                {i === 0 && teachers.length > 1 ? (
                  <Text
                    style={{
                      fontSize: 11,
                      fontWeight: '700',
                      backgroundColor: c.lime,
                      color: c.ink,
                      paddingHorizontal: 6,
                      paddingVertical: 1,
                      borderRadius: 6,
                      overflow: 'hidden',
                    }}
                  >
                    {t('cl.child.mostHours')}
                  </Text>
                ) : null}
              </View>
              <Text style={{ color: c.muted, fontSize: 13 }} numberOfLines={2}>
                {x.subjects.map((s) => subjName.get(s) ?? s).join(', ')} ·{' '}
                {t('cl.child.hoursWeek', { h: x.hoursPerWeek })}
              </Text>
            </View>
          </View>
        ))}
        {teachers.length > 3 ? (
          <Pressable
            onPress={() => setAllTeachers(!allTeachers)}
            accessibilityRole="button"
            style={{ minHeight: 36, justifyContent: 'center' }}
          >
            <Text style={{ color: c.accent, fontWeight: '700' }}>
              {allTeachers ? t('cl.showLess') : t('cl.showAll', { count: teachers.length })}
            </Text>
          </Pressable>
        ) : null}
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        accessibilityRole="tablist"
        contentContainerStyle={{ gap: 6 }}
      >
        {TABS.map((x) => (
          <Pressable
            key={x}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === x }}
            onPress={() => setTab(x)}
            style={{
              minHeight: 40,
              paddingHorizontal: 14,
              borderRadius: 20,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: tab === x ? c.accent : c.card,
              borderWidth: 1,
              borderColor: tab === x ? c.accent : c.line,
            }}
          >
            <Text style={{ color: tab === x ? '#FFFFFF' : c.ink, fontWeight: '600', fontSize: 14 }}>
              {tabLabel[x]}
              {x === 'attendance' && openAbs ? ` · ${openAbs}` : ''}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {tab === 'updates' ? (
        <View style={{ gap: 10 }}>
          <PeriodToggle value={period} onChange={setPeriod} />
          {!items.isLoading && !(period === 'current' ? updates : past).length ? (
            <P muted small>
              {period === 'current' ? t('cl.child.noUpdates') : t('cl.nothingPast')}
            </P>
          ) : null}
          {(period === 'current' ? updates : past).map((i) => (
            <ItemCard key={i.id} item={i} />
          ))}
        </View>
      ) : null}

      {tab === 'timetable' ? <Timetable p={p} /> : null}
      {tab === 'attendance' ? <Attendance absences={absences} loaded={!!p} /> : null}

      {tab === 'documents' ? (
        <View style={{ gap: 10 }}>
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder={t('cl.child.searchDocs')}
            placeholderTextColor={c.muted}
            accessibilityLabel={t('cl.child.searchDocs')}
            style={{
              minHeight: 46,
              borderWidth: 1,
              borderColor: c.line,
              borderRadius: 12,
              backgroundColor: c.card,
              paddingHorizontal: 14,
              fontSize: 15,
              color: c.ink,
            }}
          />
          {!docs.isLoading && !docs.data?.length ? (
            <P muted small>
              {t('cl.child.noDocs')}
            </P>
          ) : null}
          {(docs.data ?? []).map((d) => (
            <Pressable
              key={d.id}
              onPress={() => open(d.id, d.title || d.item.title, d.filename)}
              accessibilityRole="link"
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                backgroundColor: c.card,
                borderWidth: 1,
                borderColor: c.line,
                borderRadius: 14,
                padding: 12,
              }}
            >
              <View
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  backgroundColor: c.accentSoft,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Icon name="file" size={18} color={c.accent} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ color: c.ink, fontSize: 15, fontWeight: '600' }} numberOfLines={2}>
                  {d.title || d.item.title}
                </Text>
                <Text style={{ color: c.muted, fontSize: 12 }} numberOfLines={1}>
                  {[d.filename, d.item.postedAt ? shortDate(d.item.postedAt, i18n.language) : null]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              </View>
            </Pressable>
          ))}
        </View>
      ) : null}

      {tab === 'grades' ? (
        <P muted small>
          {t('cl.child.gradesEmpty')}
        </P>
      ) : null}

      {p?.detailsSyncedAt ? (
        <Text style={{ color: c.muted, fontSize: 12, textAlign: 'center' }}>
          {t('cl.child.synced', { when: relative(p.detailsSyncedAt, i18n.language) })}
        </Text>
      ) : null}
      <View style={{ height: space.l }} />
    </Screen>
  );
}

function Timetable({ p }: { p: ChildProfile | undefined }) {
  const { t, i18n } = useTranslation();
  const c = useTheme();
  const today = madridNow().day;
  const [day, setDay] = useState(today <= 5 ? today : 1);
  const tt = p?.timetable ?? [];
  if (p && !tt.length)
    return (
      <P muted small>
        {t('cl.child.noTimetable')}
      </P>
    );
  const sessions = tt.filter((s) => s.day === day).sort((a, b) => a.start.localeCompare(b.start));
  return (
    <View style={{ gap: 10 }}>
      <View
        accessibilityLabel={t('cl.child.pickDay')}
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
        {[1, 2, 3, 4, 5].map((d) => (
          <Pressable
            key={d}
            onPress={() => setDay(d)}
            accessibilityRole="button"
            accessibilityState={{ selected: day === d }}
            style={{
              flex: 1,
              minHeight: 40,
              borderRadius: 10,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: day === d ? c.accent : d === today ? c.accentSoft : 'transparent',
            }}
          >
            <Text style={{ color: day === d ? '#FFFFFF' : c.ink, fontWeight: '600', fontSize: 13 }}>
              {weekdayName(d, i18n.language, 'short')}
            </Text>
          </Pressable>
        ))}
      </View>
      {sessions.map((s, i) => {
        const translated = subjectOf(s);
        return (
          <View
            key={`${s.start}-${i}`}
            style={{
              flexDirection: 'row',
              gap: 12,
              backgroundColor: c.card,
              borderWidth: 1,
              borderColor: c.line,
              borderRadius: 14,
              padding: 12,
            }}
          >
            <View style={{ width: 52 }}>
              <Text style={{ color: c.ink, fontSize: 14, fontWeight: '700' }}>{s.start}</Text>
              <Text style={{ color: c.muted, fontSize: 12 }}>{s.end}</Text>
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ color: c.ink, fontSize: 15, fontWeight: '600' }}>{translated}</Text>
              {translated !== s.subject ? (
                <Text style={{ color: c.muted, fontSize: 12 }}>{s.subject}</Text>
              ) : null}
              {s.teachers.length || s.room ? (
                <Text style={{ color: c.mutedOnBg, fontSize: 13 }}>
                  {[s.teachers.length ? t('cl.child.with', { names: s.teachers.join(', ') }) : null, s.room]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

function Attendance({ absences, loaded }: { absences: Absence[]; loaded: boolean }) {
  const { t, i18n } = useTranslation();
  const c = useTheme();
  if (loaded && !absences.length)
    return (
      <P muted small>
        {t('cl.child.noAbsences')}
      </P>
    );
  const tone = (s: Absence['status']) => (s === 'justified' ? c.accent : s === 'pending' ? c.muted : c.warn);
  const bg = (s: Absence['status']) =>
    s === 'justified' ? c.accentSoft : s === 'pending' ? c.line : '#F6EAD3';
  return (
    <View style={{ gap: 10 }}>
      {absences.length ? (
        <Text style={{ color: c.ink, fontSize: 15, fontWeight: '700' }}>
          {t('cl.child.absences', { count: absences.length })}
        </Text>
      ) : null}
      {absences.map((a) => (
        <View
          key={a.id}
          style={{
            backgroundColor: c.card,
            borderWidth: 1,
            borderColor: a.status === 'unjustified' ? c.warn : c.line,
            borderRadius: 14,
            padding: 12,
            gap: 6,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ color: c.ink, fontSize: 15, fontWeight: '700', flex: 1 }}>
              {dayLabel(a.day, i18n.language)}
              {a.period ? (
                <Text
                  style={{ color: c.muted, fontWeight: '400' }}
                >{` · ${t('cl.child.period', { p: a.period })}`}</Text>
              ) : null}
            </Text>
            <Text
              style={{
                fontSize: 12,
                fontWeight: '700',
                color: tone(a.status),
                backgroundColor: bg(a.status),
                paddingHorizontal: 8,
                paddingVertical: 2,
                borderRadius: 8,
                overflow: 'hidden',
              }}
            >
              {t(`cl.child.${a.status}`)}
            </Text>
          </View>
          {a.subject ? <Text style={{ color: c.mutedOnBg, fontSize: 13 }}>{a.subject}</Text> : null}
          {a.reason ? <Text style={{ color: c.ink, fontSize: 14 }}>{a.reason}</Text> : null}
          {a.status === 'unjustified' ? (
            <Text style={{ color: c.warn, fontSize: 13, lineHeight: 18 }}>
              {t('cl.child.needsReason')} {a.canJustify ? t('cl.child.justifyNote') : ''}
            </Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}

/** School, class and a Call button. GestIB doesn't show the school's phone, so the parent adds it once. */
function SchoolCard({
  name,
  classLabel,
  phone,
  childId,
}: {
  name: string | null;
  classLabel: string | null;
  phone: string | null;
  childId: string;
}) {
  const { t } = useTranslation();
  const c = useTheme();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(phone ?? '');
  const [error, setError] = useState(false);
  if (!name && !classLabel && !phone && !editing) {
    return (
      <Pressable
        onPress={() => setEditing(true)}
        accessibilityRole="button"
        style={{ minHeight: 44, justifyContent: 'center' }}
      >
        <Text style={{ color: c.accent, fontWeight: '700' }}>{t('cl.schoolInfo.addPhone')}</Text>
      </Pressable>
    );
  }
  const save = async () => {
    setError(false);
    try {
      await api(`/children/${childId}`, { method: 'PATCH', body: { schoolPhone: value.trim() || null } });
      await qc.invalidateQueries({ queryKey: ['children'] });
      setEditing(false);
    } catch {
      setError(true);
    }
  };
  return (
    <View
      style={{
        backgroundColor: c.card,
        borderWidth: 1,
        borderColor: c.line,
        borderRadius: 16,
        padding: 14,
        gap: 10,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text
            style={{
              fontSize: 11,
              fontWeight: '700',
              letterSpacing: 0.6,
              textTransform: 'uppercase',
              color: c.muted,
            }}
          >
            {t('cl.schoolInfo.title')}
          </Text>
          <Text style={{ color: c.ink, fontSize: 16, fontWeight: '700' }}>
            {name ?? t('cl.schoolInfo.unknown')}
          </Text>
          {classLabel ? <Text style={{ color: c.mutedOnBg, fontSize: 14 }}>{classLabel}</Text> : null}
        </View>
        {phone && !editing ? (
          <Pressable
            onPress={() => void Linking.openURL(`tel:${phone.replace(/\s/g, '')}`)}
            accessibilityRole="button"
            accessibilityLabel={`${t('cl.schoolInfo.call')} ${phone}`}
            style={({ pressed }) => ({
              minHeight: 44,
              paddingHorizontal: 16,
              borderRadius: 22,
              backgroundColor: pressed ? c.accentPressed : c.accent,
              alignItems: 'center',
              justifyContent: 'center',
            })}
          >
            <Text style={{ color: '#FFFFFF', fontWeight: '700', fontSize: 15 }}>
              {t('cl.schoolInfo.call')}
            </Text>
          </Pressable>
        ) : null}
      </View>
      {editing ? (
        <View style={{ gap: 8 }}>
          <TextInput
            value={value}
            onChangeText={setValue}
            placeholder="971 000 000"
            placeholderTextColor={c.muted}
            keyboardType="phone-pad"
            inputMode="tel"
            accessibilityLabel={t('cl.schoolInfo.phone')}
            style={{
              minHeight: 46,
              borderWidth: 1,
              borderColor: error ? c.danger : c.line,
              borderRadius: 12,
              paddingHorizontal: 14,
              fontSize: 16,
              color: c.ink,
              backgroundColor: c.bg,
            }}
          />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pressable
              onPress={() => void save()}
              accessibilityRole="button"
              style={{
                flex: 1,
                minHeight: 44,
                borderRadius: 12,
                backgroundColor: c.accent,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={{ color: '#FFFFFF', fontWeight: '700' }}>{t('common.save')}</Text>
            </Pressable>
            {name ? (
              <Pressable
                onPress={() =>
                  void Linking.openURL(
                    `https://www.google.com/search?q=${encodeURIComponent(`${name} telèfon`)}`,
                  )
                }
                accessibilityRole="link"
                style={{
                  flex: 1,
                  minHeight: 44,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: c.accent,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text style={{ color: c.accent, fontWeight: '700' }}>{t('cl.schoolInfo.find')}</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : (
        <Pressable
          onPress={() => setEditing(true)}
          accessibilityRole="button"
          style={{ minHeight: 32, justifyContent: 'center' }}
        >
          <Text style={{ color: c.accent, fontWeight: '700', fontSize: 13 }}>
            {phone ? t('cl.schoolInfo.editPhone') : t('cl.schoolInfo.addPhone')}
          </Text>
        </Pressable>
      )}
    </View>
  );
}
