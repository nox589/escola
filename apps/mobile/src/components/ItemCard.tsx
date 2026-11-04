import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import type { FeedItem } from '@/lib/api';
import { shortDate } from '@/lib/hooks';
import { font, space, useTheme } from '@/lib/theme';
import { Badge, Card, Row } from './ui';

export function ItemCard({ item }: { item: FeedItem }) {
  const { t, i18n } = useTranslation();
  const c = useTheme();
  const due = item.action?.deadlineAt ? new Date(item.action.deadlineAt) : null;
  const soon = due && due.getTime() - Date.now() < 3 * 86400_000;
  return (
    <Card
      accent={item.child?.colour ?? undefined}
      onPress={() => router.push({ pathname: '/item/[id]', params: { id: item.id } })}
    >
      <Row style={{ justifyContent: 'space-between' }}>
        <Text
          style={{
            color: c.muted,
            fontSize: font.tiny,
            fontWeight: '600',
            textTransform: 'uppercase',
            letterSpacing: 0.5,
          }}
        >
          {[item.child?.name, t(`sections.${item.section}` as 'sections.other')].filter(Boolean).join(' · ')}
        </Text>
        {item.postedAt ? (
          <Text style={{ color: c.muted, fontSize: font.tiny }}>
            {shortDate(item.postedAt, i18n.language)}
          </Text>
        ) : null}
      </Row>
      <Text
        style={{ color: c.ink, fontSize: font.body, fontWeight: item.read ? '500' : '700' }}
        numberOfLines={2}
      >
        {!item.read ? '● ' : ''}
        {item.title}
      </Text>
      {item.summary ? (
        <Text style={{ color: c.muted, fontSize: font.small, lineHeight: 20 }} numberOfLines={2}>
          {item.summary}
        </Text>
      ) : null}
      {item.action || item.checkOriginal ? (
        <View style={{ flexDirection: 'row', gap: space.s, flexWrap: 'wrap', marginTop: 2 }}>
          {item.action ? (
            <Badge label={t(`actions.${item.action.kind}` as 'actions.reply')} tone="ok" />
          ) : null}
          {due ? (
            <Badge
              label={t('home.due', { date: shortDate(due.toISOString(), i18n.language) })}
              tone={soon ? 'danger' : 'warn'}
            />
          ) : null}
          {item.checkOriginal ? <Badge label={t('item.showOriginal')} tone="warn" /> : null}
        </View>
      ) : null}
    </Card>
  );
}
