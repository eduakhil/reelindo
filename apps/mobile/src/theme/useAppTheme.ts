import { useColorScheme } from 'react-native';
import { palette } from './theme';
import { usePreferencesStore } from '@/src/store/preferences';
export function useAppTheme() {
  const system = useColorScheme(); const mode = usePreferencesStore((state) => state.themeMode);
  const isDark = mode === 'system' ? system !== 'light' : mode === 'dark';
  return { colors: isDark ? palette.dark : palette.light, isDark } as const;
}
