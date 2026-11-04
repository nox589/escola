import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { api } from './api';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: true,
  }),
});

/** Asks permission, gets the Expo push token, registers it with the API. Returns false if not possible. */
export async function registerForPush(locale: string): Promise<boolean> {
  if (Platform.OS === 'web' || !Device.isDevice) return false;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'School updates',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
  const current = await Notifications.getPermissionsAsync();
  const status = current.granted ? current : await Notifications.requestPermissionsAsync();
  if (!status.granted) return false;
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  const { data } = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
  await api('/devices', { body: { expoPushToken: data, platform: Platform.OS, locale } });
  return true;
}

/** Item id from a tapped notification, for deep-linking to the item. */
export function itemIdFromResponse(r: Notifications.NotificationResponse | null): string | null {
  const id = r?.notification.request.content.data?.itemId;
  return typeof id === 'string' ? id : null;
}
