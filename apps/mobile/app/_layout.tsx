import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Platform } from 'react-native';
import { router } from 'expo-router';
import Constants from 'expo-constants';
import { useAuthStore } from '@/src/store/auth';
import { usePreferencesStore } from '@/src/store/preferences';
import { useAppTheme } from '@/src/theme/useAppTheme';
import { registerDeviceToken } from '@/src/services/api';
import i18n from '@/src/i18n';
import { configureVideoCache } from '@/src/services/video-cache';

configureVideoCache();

export default function RootLayout() {
  const initialize = useAuthStore((state) => state.initialize);
  const authenticated = useAuthStore((state) => state.authenticated);
  const userLanguage = useAuthStore((state) => state.user?.language);
  const restorePreferences = usePreferencesStore((state) => state.restore);
  const { colors, isDark } = useAppTheme();
  useEffect(() => { void initialize(); void restorePreferences(); }, [initialize, restorePreferences]);
  useEffect(() => { if (userLanguage) void i18n.changeLanguage(userLanguage); }, [userLanguage]);
  useEffect(() => {
    if (
      !authenticated ||
      Platform.OS === 'web' ||
      Constants.appOwnership === 'expo' ||
      Constants.expoGoConfig !== null
    ) return;
    let active = true;
    let removeResponseListener: (() => void) | undefined;
    void import('expo-notifications').then(async (Notifications) => {
      if (!active) return;
      const response = Notifications.addNotificationResponseReceivedListener((event) => {
        const data = event.notification.request.content.data as { type?: string; conversationId?: string; userId?: string };
        if (data.conversationId) router.push(`/chat/${data.conversationId}`);
        else if (data.type) router.push('/(tabs)/inbox');
      });
      removeResponseListener = () => response.remove();
      try {
        const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
        if (!projectId) return;
        const permission = await Notifications.getPermissionsAsync();
        const granted = permission.granted || (await Notifications.requestPermissionsAsync()).granted;
        if (!granted || !active) return;
        if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync('default', { name: 'Reelindo updates', importance: Notifications.AndroidImportance.DEFAULT });
        const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
        if (active) await registerDeviceToken(token, Platform.OS === 'ios' ? 'ios' : 'android');
      } catch (error) {
        console.warn('Push notification setup failed.', error);
      }
    }).catch((error: unknown) => {
      if (active) console.warn('Push notification module could not be loaded.', error);
    });
    return () => { active = false; removeResponseListener?.(); };
  }, [authenticated]);
  return <><StatusBar style={isDark ? 'light' : 'dark'} /><Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }} /></>;
}
