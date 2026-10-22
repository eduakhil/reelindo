import { useId } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';
import { radius } from '@/src/theme/theme';
export function Avatar({ uri, name, size = 44, hasStory = false, storyStatus }: { uri?: string | null; name: string; size?: number; hasStory?: boolean; storyStatus?: 'unseen' | 'seen' }) {
  const initials = name.trim().slice(0, 1).toUpperCase() || '?';
  const ringSize = size + (hasStory || storyStatus ? 6 : 0);
  const gradientId = useId().replace(/:/g, '');
  return <View style={[styles.ring, { width: ringSize, height: ringSize, borderRadius: radius.pill, padding: hasStory || storyStatus ? 3 : 0, borderWidth: storyStatus === 'unseen' ? 0 : storyStatus === 'seen' || hasStory ? 2 : 0, borderColor: storyStatus === 'seen' ? '#9AA8B2' : hasStory ? '#0E9F95' : 'transparent' }]}>
    {uri ? <Image source={{ uri }} cachePolicy="memory-disk" style={{ width: size, height: size, borderRadius: radius.pill }} /> : <View style={[styles.fallback, { width: size, height: size, borderRadius: radius.pill }]}><Text style={styles.initial}>{initials}</Text></View>}
    {storyStatus === 'unseen' ? <Svg width={ringSize} height={ringSize} viewBox={`0 0 ${ringSize} ${ringSize}`} style={styles.storyGradient}>
      <Defs><LinearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
        <Stop offset="0%" stopColor="#55C9BC" />
        <Stop offset="55%" stopColor="#3978D4" />
        <Stop offset="100%" stopColor="#0E9F95" />
      </LinearGradient></Defs>
      <Circle cx={ringSize / 2} cy={ringSize / 2} r={(ringSize - 2) / 2} fill="none" stroke={`url(#${gradientId})`} strokeWidth={2} />
    </Svg> : null}
  </View>;
}
const styles = StyleSheet.create({ ring: { alignItems: 'center', justifyContent: 'center' }, storyGradient: { position: 'absolute' }, fallback: { backgroundColor: '#EAF1F5', alignItems: 'center', justifyContent: 'center' }, initial: { color: '#183040', fontWeight: '700', fontSize: 18 } });
