import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import * as LocalAuthentication from 'expo-local-authentication';
import { useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  type ScrollViewInstance,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BackLink, Dot } from '@/components/Clases';
import { LinkedText, LinkList } from '@/components/Linked';
import { Loading } from '@/components/ui';
import { LANG_NAMES } from '@/i18n';
import { api, ApiError, type Submission, type ThreadDetail } from '@/lib/api';
import { shortDate, useChildren, useMe } from '@/lib/hooks';
import { space, useTheme } from '@/lib/theme';

async function reauthenticate(prompt: string): Promise<boolean> {
  if (Platform.OS === 'web') return true;
  const has = await LocalAuthentication.hasHardwareAsync();
  const enrolled = has && (await LocalAuthentication.isEnrolledAsync());
  if (!enrolled) return true;
  return (await LocalAuthentication.authenticateAsync({ promptMessage: prompt })).success;
}

/**
 * A conversation with one teacher or office, chat-style. Their messages appear in the parent's
 * language with the original one tap away. To reply: write in your language, see the exact polite
 * version the school will get plus a back-translation, then send (or copy it into GestIB while
 * sending from clases is switched off).
 */
export default function ThreadScreen() {
  const { key } = useLocalSearchParams<{ key: string }>();
  const { t, i18n } = useTranslation();
  const c = useTheme();
  const qc = useQueryClient();
  const me = useMe();
  const kids = useChildren();
  const q = useQuery({
    queryKey: ['thread', key],
    queryFn: () => api<ThreadDetail>(`/threads/${key}`),
    // Poll while a sent reply is still on its way, so "Delivered" appears without a refresh.
    refetchInterval: (query) =>
      query.state.data?.replies.some((r) =>
        ['confirmed', 'queued', 'submitting', 'verifying'].includes(r.state),
      )
        ? 4000
        : false,
  });
  const kinds = useQuery({
    queryKey: ['submission-types'],
    queryFn: () => api<{ kinds: { kind: string; enabled: boolean }[] }>('/submission-types'),
  });
  const canSend = !!kinds.data?.kinds.some((k) => k.kind === 'reply_message' && k.enabled);
  const [originals, setOriginals] = useState<Record<string, boolean>>({});
  const [text, setText] = useState('');
  const [draft, setDraft] = useState<Submission | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const scroller = useRef<ScrollViewInstance>(null);

  // Opening the conversation marks its messages read in clases (never in GestIB).
  useEffect(() => {
    const unread = q.data?.messages.filter((m) => !m.read) ?? [];
    if (!unread.length) return;
    void Promise.all(
      unread.map((m) => api(`/items/${m.id}/read`, { method: 'POST' }).catch(() => undefined)),
    ).then(() => qc.invalidateQueries({ queryKey: ['threads'] }));
  }, [q.data, qc]);

  type Entry =
    | { kind: 'in'; at: string; m: ThreadDetail['messages'][number] }
    | { kind: 'out'; at: string; r: ThreadDetail['replies'][number] };
  const entries = useMemo<Entry[]>(() => {
    if (!q.data) return [];
    const list: Entry[] = [
      ...q.data.messages.map((m) => ({ kind: 'in' as const, at: m.postedAt ?? '', m })),
      ...q.data.replies
        .filter((r) => r.state !== 'draft' && r.state !== 'awaiting_confirmation')
        .map((r) => ({ kind: 'out' as const, at: r.createdAt, r })),
    ];
    return list.sort((a, b) => a.at.localeCompare(b.at));
  }, [q.data]);

  if (!q.data) return <Loading />;
  const th = q.data;
  const name = th.sender ?? t('cl.school');
  const latest = th.messages[th.messages.length - 1]!;
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
      const body = { user_input: { text } };
      const s = draft
        ? await api<Submission>(`/submissions/${draft.id}`, { method: 'PATCH', body })
        : await api<Submission>('/submissions', {
            body: {
              kind: 'reply_message',
              child_id: latest.child?.id ?? kids.data?.[0]?.id,
              item_id: latest.id,
              ...body,
            },
          });
      setDraft(s);
      setTimeout(() => scroller.current?.scrollToEnd({ animated: true }), 50);
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
      setDraft(null);
      setText('');
      await qc.invalidateQueries({ queryKey: ['thread', key] });
    } catch (e) {
      setNote(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!draft?.draftOriginal) return;
    await Clipboard.setStringAsync(draft.draftOriginal);
    setNote(t('cl.chat.copied'));
  };

  const time = (iso: string | null) =>
    iso
      ? `${shortDate(iso, i18n.language)} ${new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' }).format(new Date(iso))}`
      : '';

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
            <Text style={{ color: c.accent, fontWeight: '700' }}>{name.trim()[0]?.toUpperCase() ?? '?'}</Text>
          </View>
          <Text
            accessibilityRole="header"
            style={{ color: c.ink, fontSize: 17, fontWeight: '700', flex: 1 }}
            numberOfLines={1}
          >
            {name}
          </Text>
        </View>

        <ScrollView
          ref={scroller}
          contentContainerStyle={{ padding: space.l, gap: 10 }}
          onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: false })}
        >
          {entries.map((e) =>
            e.kind === 'in' ? (
              <View key={e.m.id} style={{ alignSelf: 'flex-start', maxWidth: '86%', gap: 4 }}>
                <View
                  style={{
                    backgroundColor: c.card,
                    borderWidth: 1,
                    borderColor: c.line,
                    borderRadius: 18,
                    borderTopLeftRadius: 6,
                    padding: 12,
                    gap: 6,
                  }}
                >
                  {e.m.child ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Dot colour={e.m.child.colour} size={6} />
                      <Text style={{ color: c.muted, fontSize: 12, fontWeight: '600' }}>
                        {e.m.child.name}
                      </Text>
                    </View>
                  ) : null}
                  <Text style={{ color: c.ink, fontSize: 15, fontWeight: '700' }}>
                    {originals[e.m.id] ? e.m.original.title : e.m.title}
                  </Text>
                  <LinkedText style={{ color: c.ink, fontSize: 15, lineHeight: 21 }}>
                    {originals[e.m.id] || !e.m.body ? e.m.original.body : e.m.body}
                  </LinkedText>
                  <LinkList links={e.m.links} />
                  {e.m.body ? (
                    <Pressable
                      onPress={() => setOriginals({ ...originals, [e.m.id]: !originals[e.m.id] })}
                      accessibilityRole="button"
                      style={{ minHeight: 28, justifyContent: 'center' }}
                    >
                      <Text style={{ color: c.accent, fontSize: 13, fontWeight: '700' }}>
                        {originals[e.m.id]
                          ? t('cl.chat.showTranslation')
                          : t('cl.chat.showOriginal', {
                              lang: LANG_NAMES[e.m.original.lang] ?? e.m.original.lang,
                            })}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
                <Text style={{ color: c.muted, fontSize: 11, marginLeft: 6 }}>{time(e.m.postedAt)}</Text>
              </View>
            ) : (
              <View key={e.r.id} style={{ alignSelf: 'flex-end', maxWidth: '86%', gap: 4 }}>
                <View
                  style={{
                    backgroundColor: c.accent,
                    borderRadius: 18,
                    borderTopRightRadius: 6,
                    padding: 12,
                    gap: 4,
                  }}
                >
                  <Text style={{ color: '#FFFFFF', fontSize: 15, lineHeight: 21 }}>{e.r.text}</Text>
                  {e.r.sentText ? (
                    <Text style={{ color: '#D2E0DC', fontSize: 13, lineHeight: 18 }}>{e.r.sentText}</Text>
                  ) : null}
                </View>
                <Text style={{ color: c.muted, fontSize: 11, alignSelf: 'flex-end', marginRight: 6 }}>
                  {time(e.r.createdAt)} ·{' '}
                  {e.r.state === 'succeeded'
                    ? t('cl.chat.delivered')
                    : e.r.state === 'failed'
                      ? t('cl.chat.failed')
                      : t('cl.chat.sending')}
                </Text>
              </View>
            ),
          )}

          {draft?.draftOriginal ? (
            <View
              style={{
                alignSelf: 'flex-end',
                width: '92%',
                backgroundColor: c.card,
                borderWidth: 1,
                borderColor: c.accent,
                borderRadius: 16,
                padding: 12,
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
                {t('cl.chat.schoolGets')}
              </Text>
              <Text style={{ color: c.ink, fontSize: 15, lineHeight: 21, fontWeight: '600' }}>
                {draft.draftOriginal}
              </Text>
              {draft.preview ? (
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
                    {t('cl.chat.backTranslation')}
                  </Text>
                  <Text style={{ color: c.mutedOnBg, fontSize: 14, lineHeight: 20 }}>{draft.preview}</Text>
                </>
              ) : null}
              {canSend ? (
                <Pressable
                  onPress={() => void send()}
                  disabled={busy || !me.data?.canSubmit}
                  accessibilityRole="button"
                  style={{
                    minHeight: 46,
                    borderRadius: 12,
                    backgroundColor: c.accent,
                    alignItems: 'center',
                    justifyContent: 'center',
                    opacity: busy ? 0.6 : 1,
                  }}
                >
                  <Text style={{ color: '#FFFFFF', fontSize: 15, fontWeight: '700' }}>
                    {t('cl.chat.send')}
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
                      onPress={() =>
                        void WebBrowser.openBrowserAsync('https://www3.caib.es/xestibback/families/missatges')
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
                      <Text style={{ color: c.accent, fontSize: 14, fontWeight: '700' }}>
                        {t('item.openGestib')}
                      </Text>
                    </Pressable>
                  </View>
                </>
              )}
            </View>
          ) : null}
          {note ? (
            <Text style={{ color: c.mutedOnBg, fontSize: 13, textAlign: 'center' }}>{note}</Text>
          ) : null}
        </ScrollView>

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'flex-end',
            gap: 8,
            padding: space.m,
            borderTopWidth: 1,
            borderTopColor: c.line,
            backgroundColor: c.card,
          }}
        >
          <TextInput
            value={text}
            onChangeText={(v) => {
              setText(v);
              if (draft) setDraft({ ...draft, draftOriginal: null, preview: null });
            }}
            placeholder={t('cl.chat.placeholder', { lang: LANG_NAMES[i18n.language] ?? 'English' })}
            placeholderTextColor={c.muted}
            accessibilityLabel={t('cl.chat.placeholder', { lang: LANG_NAMES[i18n.language] ?? 'English' })}
            multiline
            style={{
              flex: 1,
              minHeight: 44,
              maxHeight: 140,
              borderWidth: 1,
              borderColor: c.line,
              borderRadius: 22,
              paddingHorizontal: 16,
              paddingVertical: 11,
              fontSize: 15,
              color: c.ink,
              backgroundColor: c.bg,
            }}
          />
          <Pressable
            onPress={() => void translate()}
            disabled={busy || !text.trim()}
            accessibilityRole="button"
            accessibilityLabel={t('cl.chat.prepare')}
            style={{
              height: 44,
              paddingHorizontal: 16,
              borderRadius: 22,
              backgroundColor: text.trim() ? c.accent : c.line,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ color: text.trim() ? '#FFFFFF' : c.muted, fontWeight: '700' }}>
              {busy ? '…' : t('cl.chat.prepare')}
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
