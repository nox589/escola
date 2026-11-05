import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';
import { Badge, Banner, Button, Card, Divider, H1, Loading, P, Row, Screen } from '@/components/ui';
import { LinkedText, LinkList } from '@/components/Linked';
import { LANG_NAMES } from '@/i18n';
import { api, type ItemDetail } from '@/lib/api';
import { shortDate, threadKeyOf } from '@/lib/hooks';
import { font, space, useTheme } from '@/lib/theme';

/** SPEC §11 screen 8. Golden rule 5: the original is always one tap away (and shown first if untranslated). */
export default function Item() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, i18n } = useTranslation();
  const c = useTheme();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['item', id], queryFn: () => api<ItemDetail>(`/items/${id}`) });
  const [showOriginal, setShowOriginal] = useState(false);
  const enabled = useQuery({
    queryKey: ['submission-types'],
    queryFn: () => api<{ kinds: { kind: string; enabled: boolean }[] }>('/submission-types'),
  });

  useEffect(() => {
    if (id)
      void api(`/items/${id}/read`, { method: 'POST' }).then(() =>
        qc.invalidateQueries({ queryKey: ['items'] }),
      );
  }, [id, qc]);

  // Messages live in the Messages tab as conversations (push notifications land here too).
  useEffect(() => {
    if (q.data?.section === 'message')
      router.replace({ pathname: '/thread/[key]', params: { key: threadKeyOf(q.data.sender) } });
  }, [q.data]);

  if (!q.data || q.data.section === 'message') return <Loading />;
  const it = q.data;
  const tr = it.translation;
  const original = showOriginal || !tr;
  const action = it.actions.find((a) => a.state === 'open');
  const canReply =
    enabled.data?.kinds.some((k) => k.kind === 'reply_message' && k.enabled) && it.section === 'message';

  // Until sending from clases is switched on, open the same page in GestIB (the parent signs in there).
  const GESTIB_PAGE: Record<string, string> = {
    message: 'missatges',
    circular: 'circulars',
    authorisation: 'autoritzacions',
    attendance: 'assistencia',
  };
  const gestibPage = !canReply ? GESTIB_PAGE[it.section] : undefined;

  const setActionState = async (state: 'done_elsewhere' | 'dismissed') => {
    if (!action) return;
    await api(`/items/${it.id}/actions/${action.id}`, { body: { state } });
    await qc.invalidateQueries();
    router.back();
  };

  const openAttachment = (attId: string, filename: string) =>
    router.push({
      pathname: '/doc/[id]',
      params: {
        id: attId,
        name:
          q.data && q.data.attachments.length === 1
            ? (q.data.translation?.title ?? q.data.original.title)
            : filename,
        file: filename,
      },
    });

  return (
    <Screen>
      <Row style={{ flexWrap: 'wrap' }}>
        {it.child ? <Badge label={it.child.name} /> : null}
        <Badge label={t(`sections.${it.section}` as 'sections.other')} />
        {it.postedAt ? (
          <P muted small>
            {shortDate(it.postedAt, i18n.language)}
          </P>
        ) : null}
      </Row>
      <H1>{original ? it.original.title : tr!.title}</H1>
      {it.sender ? <P muted small>{`${t('item.from')}: ${it.sender}`}</P> : null}

      {action ? (
        <Card accent={c.warn}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text style={{ color: c.ink, fontWeight: '700', fontSize: font.body }}>
              {t(`actions.${action.kind}` as 'actions.reply')}
            </Text>
            {action.deadlineAt ? (
              <Badge
                label={t('home.due', { date: shortDate(action.deadlineAt, i18n.language) })}
                tone="warn"
              />
            ) : null}
          </Row>
          {tr?.summary ? <P>{tr.summary}</P> : null}
          {action.confidence < 0.6 ? (
            <P muted small>
              {t('item.checkOriginal')}
            </P>
          ) : null}
        </Card>
      ) : tr?.summary ? (
        <Card>
          <P>{tr.summary}</P>
        </Card>
      ) : null}

      {tr?.checkOriginal ? <Banner text={t('item.checkOriginal')} /> : null}
      {!tr ? <Banner text={t('item.notTranslated')} tone="ok" /> : null}

      <View style={{ gap: space.s }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <P muted small>
            {original
              ? t('item.original', { lang: LANG_NAMES[it.original.lang] ?? it.original.lang })
              : t('item.translation')}
          </P>
          {tr ? (
            <Pressable onPress={() => setShowOriginal((s) => !s)} accessibilityRole="button">
              <Text style={{ color: c.accent, fontWeight: '600', fontSize: font.small }}>
                {original ? t('item.showTranslation') : t('item.showOriginal')}
              </Text>
            </Pressable>
          ) : null}
        </Row>
        <LinkedText style={{ color: c.ink, fontSize: font.body, lineHeight: 23 }}>
          {original ? it.original.body : tr!.body}
        </LinkedText>
        <LinkList links={it.links} />
      </View>

      {it.attachments.length ? (
        <View style={{ gap: space.s }}>
          <Divider />
          <P muted small>
            {t('item.attachments')}
          </P>
          {it.attachments.map((a) => (
            <Card key={a.id} onPress={() => openAttachment(a.id, a.filename)}>
              <Row>
                <Text style={{ fontSize: 18 }}>📄</Text>
                <Text style={{ color: c.ink, flex: 1 }}>{a.filename}</Text>
                <P muted small>{`${Math.max(1, Math.round(a.size / 1024))} KB`}</P>
              </Row>
            </Card>
          ))}
        </View>
      ) : null}

      <View style={{ flex: 1 }} />
      <View style={{ gap: space.s }}>
        {canReply ? (
          <Button
            title={t('item.reply')}
            onPress={() => router.push({ pathname: '/reply/[itemId]', params: { itemId: it.id } })}
          />
        ) : null}
        {gestibPage ? (
          <Button
            title={t('item.openGestib')}
            onPress={() =>
              void WebBrowser.openBrowserAsync(`https://www3.caib.es/xestibback/families/${gestibPage}`)
            }
          />
        ) : null}
        <Button
          title={t('item.ask')}
          kind="secondary"
          onPress={() =>
            router.push({
              pathname: '/assistant',
              params: { about: it.id, title: tr?.title ?? it.original.title },
            })
          }
        />
        {action ? (
          <Row>
            <View style={{ flex: 1 }}>
              <Button
                title={t('item.markDone')}
                kind="ghost"
                onPress={() => void setActionState('done_elsewhere')}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                title={t('item.dismiss')}
                kind="ghost"
                onPress={() => void setActionState('dismissed')}
              />
            </View>
          </Row>
        ) : null}
      </View>
    </Screen>
  );
}
