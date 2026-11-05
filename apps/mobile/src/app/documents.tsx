import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text } from 'react-native';
import { Card, Chip, Field, H1, P, Row, Screen } from '@/components/ui';
import { api } from '@/lib/api';
import { shortDate, useChildren } from '@/lib/hooks';
import { useTheme } from '@/lib/theme';

interface Doc {
  id: string;
  filename: string;
  title?: string;
  mime: string;
  size: number;
  item: { id: string; title: string; postedAt: string | null; childId: string | null };
}

/** SPEC §11 screen 9: searchable documents by child/date. */
export default function Documents() {
  const { t, i18n } = useTranslation();
  const c = useTheme();
  const kids = useChildren();
  const [q, setQ] = useState('');
  const [child, setChild] = useState<string | null>(null);
  const docs = useQuery({
    queryKey: ['docs', q, child],
    queryFn: () =>
      api<Doc[]>(
        `/attachments?${new URLSearchParams({ ...(q ? { q } : {}), ...(child ? { child_id: child } : {}) })}`,
      ),
  });
  const open = (id: string, title: string, filename: string) =>
    router.push({ pathname: '/doc/[id]', params: { id, name: title, file: filename } });
  const name = (id: string | null) => kids.data?.find((k) => k.id === id);

  return (
    <Screen>
      <H1>{t('tabs.documents')}</H1>
      <Field label={t('docs.search')} value={q} onChangeText={setQ} autoCapitalize="none" />
      {(kids.data?.length ?? 0) > 1 ? (
        <Row style={{ flexWrap: 'wrap' }}>
          <Chip label={t('home.all')} active={!child} onPress={() => setChild(null)} />
          {kids.data!.map((k) => (
            <Chip
              key={k.id}
              label={k.displayName}
              colour={k.colour}
              active={child === k.id}
              onPress={() => setChild(k.id)}
            />
          ))}
        </Row>
      ) : null}
      {!docs.data?.length && !docs.isLoading ? <P muted>{t('docs.empty')}</P> : null}
      {(docs.data ?? []).map((d) => (
        <Card
          key={d.id}
          onPress={() => open(d.id, d.title || d.item.title, d.filename)}
          accent={name(d.item.childId)?.colour ?? undefined}
        >
          <Row>
            <Text style={{ fontSize: 20 }}>📄</Text>
            <Text style={{ color: c.ink, fontWeight: '600', flex: 1 }} numberOfLines={2}>
              {d.title || d.item.title}
            </Text>
          </Row>
          <P muted small>
            {[
              name(d.item.childId)?.displayName,
              d.filename,
              d.item.postedAt ? shortDate(d.item.postedAt, i18n.language) : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </P>
        </Card>
      ))}
    </Screen>
  );
}
