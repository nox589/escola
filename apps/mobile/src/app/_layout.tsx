import '@/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import { router, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Loading } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { itemIdFromResponse } from '@/lib/push';
import { useTheme } from '@/lib/theme';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

function useNotificationTaps() {
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const open = (r: Notifications.NotificationResponse | null) => {
      const id = itemIdFromResponse(r);
      if (id) router.push({ pathname: '/item/[id]', params: { id } });
    };
    void Notifications.getLastNotificationResponseAsync().then(open);
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    return () => sub.remove();
  }, []);
}

export default function RootLayout() {
  const { ready, load } = useAuth();
  const c = useTheme();
  useEffect(() => {
    void load();
  }, [load]);
  useNotificationTaps();
  if (!ready) return <Loading />;
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <StatusBar style="auto" />
        <Stack
          screenOptions={{
            headerShadowVisible: false,
            headerStyle: { backgroundColor: c.bg },
            headerTintColor: c.ink,
            contentStyle: { backgroundColor: c.bg },
            headerBackButtonDisplayMode: 'minimal',
          }}
        >
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="welcome" options={{ headerShown: false }} />
          <Stack.Screen name="sign-in" options={{ title: '' }} />
          <Stack.Screen name="auth" options={{ headerShown: false }} />
          <Stack.Screen name="consent" options={{ headerShown: false }} />
          <Stack.Screen name="link-gestib" options={{ title: '' }} />
          <Stack.Screen name="children" options={{ headerShown: false }} />
          <Stack.Screen name="notifications" options={{ headerShown: false }} />
          <Stack.Screen name="submission/[id]" options={{ title: '' }} />
          <Stack.Screen name="account-problem/[id]" options={{ title: '' }} />
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="item/[id]" options={{ title: '' }} />
          <Stack.Screen name="reply/[itemId]" options={{ title: '', presentation: 'modal' }} />
        </Stack>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
