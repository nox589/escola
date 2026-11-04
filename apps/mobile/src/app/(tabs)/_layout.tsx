import { Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Icon } from '@/components/Icon';
import { useTheme } from '@/lib/theme';

/** Two tabs (Today, Week). Ask, Settings and Documents are full screens pushed on top. */
export default function TabsLayout() {
  const { t } = useTranslation();
  const c = useTheme();
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
        options={{ title: t('cl.today'), tabBarIcon: ({ color }) => <Icon name="home" color={String(color)} /> }}
      />
      <Tabs.Screen
        name="calendar"
        options={{ title: t('cl.week'), tabBarIcon: ({ color }) => <Icon name="calendar" color={String(color)} /> }}
      />
    </Tabs>
  );
}
