import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import type { ThemeMode } from '@/src/theme/theme';

type Preferences = { onboarded: boolean; restored: boolean; themeMode: ThemeMode; dataSaver: boolean; setOnboarded: () => Promise<void>; setThemeMode: (mode: ThemeMode) => Promise<void>; setDataSaver: (enabled: boolean) => Promise<void>; restore: () => Promise<void> };
export const usePreferencesStore = create<Preferences>((set) => ({
  onboarded: false, restored: false, themeMode: 'light', dataSaver: false,
  restore: async () => {
    try {
      const [onboarded, themeMode, dataSaver] = await Promise.all([SecureStore.getItemAsync('onboarded'), SecureStore.getItemAsync('theme_mode'), SecureStore.getItemAsync('data_saver')]);
      set({ onboarded: onboarded === 'true', restored: true, themeMode: themeMode === 'dark' || themeMode === 'system' ? themeMode : 'light', dataSaver: dataSaver === 'true' });
    } catch (error) {
      console.warn('Could not restore saved app preferences. Defaults will be used.', error);
      set({ onboarded: false, restored: true, themeMode: 'light', dataSaver: false });
    }
  },
  setOnboarded: async () => { await SecureStore.setItemAsync('onboarded', 'true'); set({ onboarded: true }); },
  setThemeMode: async (themeMode) => { await SecureStore.setItemAsync('theme_mode', themeMode); set({ themeMode }); },
  setDataSaver: async (dataSaver) => { await SecureStore.setItemAsync('data_saver', String(dataSaver)); set({ dataSaver }); },
}));
