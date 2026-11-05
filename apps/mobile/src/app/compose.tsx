import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import * as LocalAuthentication from 'expo-local-authentication';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BackLink, Dot } from '@/components/Clases';
import { P } from '@/components/ui';
import { LANG_NAMES } from '@/i18n';
import { api, ApiError, type Contact, type Submission } from '@/lib/api';
import { useChildren, useMe } from '@/lib/hooks';
import { personName } from '@/lib/inbox';
import { firstName } from '@/lib/todo';
import { space, useTheme } from '@/lib/theme';

const GESTIB_MESSAGES = 'https://www3.caib.es/xestibback/families/missatges';
const MAX = 3000;

async function reauthenticate(prompt: string): Promise<boolean> {
  if (Platform.OS === 'web') return true;
  const has = await LocalAuthentication.hasHardwareAsync();
  const enrolled = has && (await LocalAuthentication.isEnrolledAsync());
  if (!enrolled) return true;
  return (await LocalAuthentication.authenticateAsync({ promptMessage: prompt })).success;
}

/**
 * New message to a teacher or tutor, like email. Write in your language; MiCole shows the exact
 * Catalan the teacher will get plus a back-translation, and nothing is sent until you press Send.
 */
export default function Compose() {
  const { t, i18n } = useTranslation();
  const c = useTheme();
  const qc = useQueryClient();
  const me = useMe();
  const kids = useChildren();
  const contacts = useQuery({ queryKey: ['contacts'], queryFn: () => api<Contact[]>('/contacts') });
  const kinds = useQuery({
    queryKey: ['submission-types'],
    queryFn: () => api<{ kinds: { kind: string; enabled: boolean }[] }>('/submission-types'),
  });
  const canSend = !!kinds.data?.kinds.some((k) => k.kind === 'new_message' && k.enabled);

  const [to, setTo] = useState<string[]>([]);
  const [subject, setSubject] = useState('');
  const [text, setText] = useState('');
  const [draft, setDraft] = useState<Submission | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'manual' | 'failed'>('idle');
  const lang = LANG_NAMES[i18n.language as keyof typeof LANG_NAMES] ?? i18n.language;

  // After Send: follow the submission until GestIB confirms it is in the sent list.
  useEffect(() => {
    if (state !== 'sending' || !draft) return;
    const id = setInterval(async () => {
      const s = await api<Submission>(`/submissions/${draft.id}`).catch(() => null);
      if (s?.state === 'succeeded') setState('sent');
      else if (s?.state === 'needs_manual') setState('manual');
      else if (s?.state === 'failed') setState('failed');
    }, 4000);
    return () => clearInterval(id);
  }, [state, draft]);

  const list = contacts.data ?? [];
  const groups = (kids.data ?? [])
    .map((k) => ({ kid: k, people: list.filter((x) => x.childId === k.id) }))
    .filter((g) => g.people.length);
  const other = list.filter((x) => !x.childId || !(kids.data ?? []).some((k) => k.id === x.childId));
  const chosen = list.filter((x) => to.includes(x.id));

  const toggle = (id: string) => {
    setTo((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
    setDraft(null);
  };

  const errorText = (e: unknown) => {
    const code = e instanceof ApiError ? e.code : '';
    if (code === 'kind_not_enabled') return t('cl.chat.sendingOff');
    if (code === 'not_allowed_to_submit') return t('reply.cantSubmit');
    if (code === 'mandate_submit_consent_required') return t('reply.mandate');
    return t('common.error');
  };

  const translate = async () => {
    setBusy(true);
    setNote(null);
    try {
      const user_input = { text, subject, contact_ids: to };
      const s = draft
        ? await api<Submission>(`/submissions/${draft.id}`, { method: 'PATCH', body: { user_input } })
        : await api<Submission>('/submissions', {
            body: {
              kind: 'new_message',
              child_id: chosen[0]?.childId ?? kids.data?.[0]?.id,
              user_input,
            },
          });
      setDraft(s);
    } catch (e) {
      setNote(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    if (!draft?.previewHash) return;
    if (!(await reauthenticate(t('reply.biometric')))) return;
    setBusy(true);
    try {
      await api(`/submissions/${draft.id}/confirm`, {
        body: { preview_hash: draft.previewHash },
        headers: { 'x-device-id': Platform.OS },
      });
      setState('sending');
      await qc.invalidateQueries({ queryKey: ['threads'] });
    } catch (e) {
      setNote(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!draft?.draftOriginal) return;
    const subj = draft.fields?.subject ? `${draft.fields.subject}\n\n` : '';
    await Clipboard.setStringAsync(subj + draft.draftOriginal);
    setNote(t('cl.chat.copied'));
  };

  const label = (x: Contact) =>
    x.role === 'tutor' ? t(x.female ? 'cl.compose.tutorF' : 'cl.compose.tutorM') : t('cl.compose.teacher');

  const Person = ({ x }: { x: Contact }) => {
    const on = to.includes(x.id);
    return (
      <Pressable
        onPress={() => x.accepts && toggle(x.id)}
        disabled={!x.accepts}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: on, disabled: !x.accepts }}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          minHeight: 52,
          paddingHorizontal: 12,
          paddingVertical: 8,
          borderRadius: 14,
          borderWidth: 1,
          borderColor: on ? c.accent : c.line,
          backgroundColor: on ? c.accentSoft : c.card,
          opacity: x.accepts ? 1 : 0.5,
        }}
      >
        <View
          style={{
            width: 22,
            height: 22,
            borderRadius: 6,
            borderWidth: 2,
            borderColor: on ? c.accent : c.line,
            backgroundColor: on ? c.accent : 'transparent',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {on ? <Text style={{ color: '#FFFFFF', fontSize: 13, fontWeight: '800' }}>✓</Text> : null}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: c.ink, fontSize: 15, fontWeight: '600' }} numberOfLines={1}>
            {personName(x.name)}
          </Text>
          <Text style={{ color: c.muted, fontSize: 12 }}>
            {x.accepts ? label(x) : t('cl.compose.noMessages')}
          </Text>
        </View>
      </Pressable>
    );
  };

  const done = state === 'sent' || state === 'manual' || state === 'failed';

  return (
    <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={{ flex: 1, backgroundColor: c.bg }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            paddingHorizontal: space.l,
            paddingVertical: 6,
            borderBottomWidth: 1,
            borderBottomColor: c.line,
          }}
        >
          <BackLink label="" />
          <Text accessibilityRole="header" style={{ color: c.ink, fontSize: 17, fontWeight: '700', flex: 1 }}>
            {t('cl.compose.title')}
          </Text>
        </View>

        <ScrollView
          contentContainerStyle={{ padding: space.l, gap: 14, paddingBottom: space.xxl }}
          keyboardShouldPersistTaps="handled"
        >
          {done ? (
            <View style={{ gap: 12, alignItems: 'center', paddingTop: 30 }}>
              <Text style={{ color: c.ink, fontSize: 20, fontWeight: '700', textAlign: 'center' }}>
                {state === 'sent'
                  ? t('cl.compose.sent')
                  : state === 'manual'
                    ? t('cl.compose.checkGestib')
                    : t('cl.chat.failed')}
              </Text>
              <P muted small>
                {chosen.map((x) => personName(x.name)).join(', ')}
              </P>
              <Pressable
                onPress={() => router.back()}
                accessibilityRole="button"
                style={{
                  minHeight: 46,
                  paddingHorizontal: 24,
                  borderRadius: 12,
                  backgroundColor: c.accent,
                  justifyContent: 'center',
                }}
              >
                <Text style={{ color: '#FFFFFF', fontWeight: '700' }}>{t('common.done')}</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <Text
                style={{
                  fontSize: 11,
                  fontWeight: '700',
                  letterSpacing: 0.6,
                  textTransform: 'uppercase',
                  color: c.muted,
                }}
              >
                {t('cl.compose.to')}
              </Text>
              {contacts.isLoading ? (
                <P muted small>
                  {t('common.loading')}
                </P>
              ) : null}
              {!contacts.isLoading && !list.length ? (
                <P muted small>
                  {t('cl.compose.noContacts')}
                </P>
              ) : null}
              {groups.map(({ kid, people }) => (
                <View key={kid.id} style={{ gap: 8 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Dot colour={kid.colour} />
                    <Text style={{ color: c.ink, fontSize: 14, fontWeight: '700' }}>
                      {firstName(kid.displayName)}
                    </Text>
                    {kid.classLabel ? (
                      <Text style={{ color: c.muted, fontSize: 13 }}>· {kid.classLabel}</Text>
                    ) : null}
                  </View>
                  {people.map((x) => (
                    <Person key={x.id} x={x} />
                  ))}
                </View>
              ))}
              {other.map((x) => (
                <Person key={x.id} x={x} />
              ))}

              <TextInput
                value={subject}
                onChangeText={(v) => {
                  setSubject(v);
                  setDraft(null);
                }}
                placeholder={t('cl.compose.subject')}
                placeholderTextColor={c.muted}
                accessibilityLabel={t('cl.compose.subject')}
                maxLength={150}
                style={{
                  minHeight: 48,
                  borderWidth: 1,
                  borderColor: c.line,
                  borderRadius: 12,
                  backgroundColor: c.card,
                  paddingHorizontal: 14,
                  fontSize: 16,
                  color: c.ink,
                }}
              />
              <TextInput
                value={text}
                onChangeText={(v) => {
                  setText(v);
                  setDraft(null);
                }}
                placeholder={t('cl.chat.placeholder', { lang })}
                placeholderTextColor={c.muted}
                accessibilityLabel={t('cl.chat.placeholder', { lang })}
                multiline
                maxLength={MAX}
                style={{
                  minHeight: 160,
                  textAlignVertical: 'top',
                  borderWidth: 1,
                  borderColor: c.line,
                  borderRadius: 12,
                  backgroundColor: c.card,
                  padding: 14,
                  fontSize: 16,
                  lineHeight: 22,
                  color: c.ink,
                }}
              />

              {!draft?.draftOriginal ? (
                <Pressable
                  onPress={() => void translate()}
                  disabled={busy || !to.length || !text.trim()}
                  accessibilityRole="button"
                  style={{
                    minHeight: 50,
                    borderRadius: 12,
                    backgroundColor: c.accent,
                    alignItems: 'center',
                    justifyContent: 'center',
                    opacity: busy || !to.length || !text.trim() ? 0.5 : 1,
                  }}
                >
                  <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '700' }}>
                    {busy ? t('common.loading') : t('cl.compose.translate')}
                  </Text>
                </Pressable>
              ) : (
                <View
                  style={{
                    backgroundColor: c.card,
                    borderWidth: 1,
                    borderColor: c.accent,
                    borderRadius: 16,
                    padding: 14,
                    gap: 8,
                  }}
                >
                  <Text
                    style={{
                      fontSize: 11,
                      fontWeight: '700',
                      letterSpacing: 0.6,
                      textTransform: 'uppercase',
                      color: c.accent,
                    }}
                  >
                    {t('cl.compose.teacherGets')}
                  </Text>
                  <Text style={{ color: c.muted, fontSize: 13 }}>
                    {t('cl.compose.to')}: {chosen.map((x) => personName(x.name)).join(', ')}
                  </Text>
                  {draft.fields?.subject ? (
                    <Text style={{ color: c.ink, fontSize: 15, fontWeight: '700' }}>
                      {draft.fields.subject}
                    </Text>
                  ) : null}
                  <Text style={{ color: c.ink, fontSize: 15, lineHeight: 21 }}>{draft.draftOriginal}</Text>
                  {draft.preview ? (
                    <>
                      <Text
                        style={{
                          fontSize: 11,
                          fontWeight: '700',
                          letterSpacing: 0.6,
                          textTransform: 'uppercase',
                          color: c.muted,
                          marginTop: 4,
                        }}
                      >
                        {t('cl.chat.backTranslation')}
                      </Text>
                      <Text style={{ color: c.mutedOnBg, fontSize: 14, lineHeight: 20 }}>
                        {draft.preview}
                      </Text>
                    </>
                  ) : null}
                  {canSend ? (
                    <Pressable
                      onPress={() => void send()}
                      disabled={busy || state === 'sending' || !me.data?.canSubmit}
                      accessibilityRole="button"
                      style={{
                        minHeight: 48,
                        borderRadius: 12,
                        backgroundColor: c.accent,
                        alignItems: 'center',
                        justifyContent: 'center',
                        opacity: busy || state === 'sending' ? 0.6 : 1,
                        marginTop: 4,
                      }}
                    >
                      <Text style={{ color: '#FFFFFF', fontSize: 15, fontWeight: '700' }}>
                        {state === 'sending' ? t('cl.chat.sending') : t('cl.compose.send')}
                      </Text>
                    </Pressable>
                  ) : (
                    <>
                      <Text style={{ color: c.mutedOnBg, fontSize: 13, lineHeight: 18 }}>
                        {t('cl.chat.sendingOff')}
                      </Text>
                      <View style={{ flexDirection: 'row', gap: 8 }}>
                        <Pressable
                          onPress={() => void copy()}
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
                          <Text style={{ color: '#FFFFFF', fontSize: 14, fontWeight: '700' }}>
                            {t('cl.chat.copy')}
                          </Text>
                        </Pressable>
                        <Pressable
                          onPress={() => void WebBrowser.openBrowserAsync(GESTIB_MESSAGES)}
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
                          <Text style={{ color: c.accent, fontSize: 14, fontWeight: '700' }}>
                            {t('item.openGestib')}
                          </Text>
                        </Pressable>
                      </View>
                    </>
                  )}
                  <Pressable
                    onPress={() => setDraft(null)}
                    accessibilityRole="button"
                    style={{ minHeight: 40, justifyContent: 'center', alignItems: 'center' }}
                  >
                    <Text style={{ color: c.accent, fontWeight: '700' }}>{t('cl.compose.edit')}</Text>
                  </Pressable>
                </View>
              )}
              {note ? (
                <Text style={{ color: c.mutedOnBg, fontSize: 13, textAlign: 'center' }}>{note}</Text>
              ) : null}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
