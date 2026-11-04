import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  View,
  type ScrollViewInstance,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Banner, Button, Chip, H1, P, Row } from '@/components/ui';
import { api, ApiError, streamAssistant } from '@/lib/api';
import { font, radius, space, useTheme } from '@/lib/theme';

interface Msg {
  role: 'user' | 'assistant';
  content: string;
  cited?: string[];
}

/** SPEC §11 screen 14: chat with suggested prompts and tappable source chips. */
export default function Assistant() {
  const { t } = useTranslation();
  const c = useTheme();
  const { about, title } = useLocalSearchParams<{ about?: string; title?: string }>();
  const [thread, setThread] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scroll = useRef<ScrollViewInstance>(null);

  useEffect(() => {
    if (about && title) setInput(`${title}: `);
  }, [about, title]);

  const send = async (text: string) => {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError(null);
    setInput('');
    try {
      const id = thread ?? (await api<{ id: string }>('/assistant/threads', { method: 'POST' })).id;
      setThread(id);
      setMsgs((m) => [...m, { role: 'user', content: text }, { role: 'assistant', content: '' }]);
      const cited = await streamAssistant(id, text, (d) =>
        setMsgs((m) => {
          const copy = [...m];
          copy[copy.length - 1] = { ...copy[copy.length - 1]!, content: copy[copy.length - 1]!.content + d };
          return copy;
        }),
      );
      setMsgs((m) => {
        const copy = [...m];
        copy[copy.length - 1] = { ...copy[copy.length - 1]!, cited };
        return copy;
      });
    } catch (e) {
      setError(e instanceof ApiError && e.status === 429 ? t('assistant.limit') : t('common.error'));
    } finally {
      setBusy(false);
      setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 50);
    }
  };

  const clean = (s: string) => s.replace(/\s*\[item:[0-9a-f-]{36}\]/g, '');

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: c.bg }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView ref={scroll} contentContainerStyle={{ padding: space.l, gap: space.m, flexGrow: 1 }}>
          <H1>{t('assistant.title')}</H1>
          <P muted small>
            {t('assistant.note')}
          </P>
          {!msgs.length ? (
            <View style={{ gap: space.s }}>
              {[t('assistant.s1'), t('assistant.s2'), t('assistant.s3')].map((s) => (
                <Chip key={s} label={s} onPress={() => void send(s)} />
              ))}
            </View>
          ) : null}
          {msgs.map((m, i) => (
            <View
              key={i}
              style={{
                alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                maxWidth: '88%',
                backgroundColor: m.role === 'user' ? c.accent : c.card,
                borderRadius: radius.l,
                padding: space.m,
                gap: space.s,
              }}
            >
              <Text
                style={{ color: m.role === 'user' ? '#fff' : c.ink, fontSize: font.body, lineHeight: 22 }}
              >
                {clean(m.content) || '…'}
              </Text>
              {m.cited?.length ? (
                <Row style={{ flexWrap: 'wrap' }}>
                  <P muted small>
                    {t('assistant.sources')}:
                  </P>
                  {m.cited.map((id, n) => (
                    <Chip
                      key={id}
                      label={`${n + 1}`}
                      onPress={() => router.push({ pathname: '/item/[id]', params: { id } })}
                    />
                  ))}
                </Row>
              ) : null}
            </View>
          ))}
          {error ? <Banner text={error} tone="danger" /> : null}
        </ScrollView>
        <View
          style={{
            flexDirection: 'row',
            gap: space.s,
            padding: space.m,
            borderTopWidth: 1,
            borderTopColor: c.line,
            backgroundColor: c.card,
          }}
        >
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder={t('assistant.placeholder')}
            placeholderTextColor={c.muted}
            onSubmitEditing={() => void send(input)}
            style={{
              flex: 1,
              fontSize: font.body,
              color: c.ink,
              paddingHorizontal: space.m,
              paddingVertical: 10,
              borderRadius: radius.m,
              backgroundColor: c.bg,
            }}
            accessibilityLabel={t('assistant.placeholder')}
          />
          <View style={{ width: 64 }}>
            <Button title="↑" onPress={() => void send(input)} loading={busy} disabled={!input.trim()} />
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
