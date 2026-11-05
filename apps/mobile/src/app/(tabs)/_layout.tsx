import { Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Icon } from '@/components/Icon';
import { useThreads } from '@/lib/hooks';
import { useTheme } from '@/lib/theme';

/** Three tabs: Today (action), Messages (conversations), Week (time). Ask, Settings and child pages sit on top. */
export default function TabsLayout() {
  const { t } = useTranslation();
  const c = useTheme();
  const unread = (useThreads().data ?? []).reduce((n, th) => n + th.unread, 0);
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.accent,
        tabBarInactiveTintColor: c.muted,
        tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
        tabBarStyle: { backgroundColor: c.card, borderTopColor: c.line, height: 64, paddingTop: 6 },
        sceneStyle: { backgroundColor: c.bg },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('cl.today'),
          tabBarIcon: ({ color }) => <Icon name="home" color={String(color)} />,
        }}
      />
      <Tabs.Screen
        name="messages"
        options={{
          title: t('cl.messages'),
          tabBarIcon: ({ color }) => <Icon name="mail" color={String(color)} />,
          tabBarBadge: unread ? unread : undefined,
          tabBarBadgeStyle: { backgroundColor: c.lime, color: c.ink, fontWeight: '700' },
        }}
      />
      <Tabs.Screen
        name="calendar"
        options={{
          title: t('cl.week'),
          tabBarIcon: ({ color }) => <Icon name="calendar" color={String(color)} />,
        }}
      />
    </Tabs>
  );
}
