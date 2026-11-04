import { Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Text, type ColorValue } from 'react-native';
import { useTheme } from '@/lib/theme';

const icon = (glyph: string) =>
  function TabIcon({ color }: { color: ColorValue }) {
    return <Text style={{ color, fontSize: 18 }}>{glyph}</Text>;
  };

export default function TabsLayout() {
  const { t } = useTranslation();
  const c = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.accent,
        tabBarInactiveTintColor: c.muted,
        tabBarStyle: { backgroundColor: c.card, borderTopColor: c.line },
      }}
    >
      <Tabs.Screen name="index" options={{ title: t('tabs.home'), tabBarIcon: icon('◉') }} />
      <Tabs.Screen name="calendar" options={{ title: t('tabs.calendar'), tabBarIcon: icon('▦') }} />
      <Tabs.Screen name="documents" options={{ title: t('tabs.documents'), tabBarIcon: icon('▤') }} />
      <Tabs.Screen name="assistant" options={{ title: t('tabs.assistant'), tabBarIcon: icon('✦') }} />
      <Tabs.Screen name="settings" options={{ title: t('tabs.settings'), tabBarIcon: icon('⚙') }} />
    </Tabs>
  );
}
