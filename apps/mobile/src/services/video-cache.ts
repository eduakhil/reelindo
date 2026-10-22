import { Platform } from 'react-native';
import * as Video from 'expo-video';

/** Configure Expo Video's native LRU cache before feed players are created. */
export function configureVideoCache() {
  if (Platform.OS === 'web') return;
  void Video.setVideoCacheSizeAsync(500 * 1024 * 1024).catch(() => {
    // Playback remains available when the native cache cannot be configured.
  });
}
