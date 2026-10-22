import { useState } from 'react';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Button } from '@/src/components/Button';
import { ReelindoMark } from '@/src/components/ReelindoMark';
import { usePreferencesStore } from '@/src/store/preferences';
import { palette } from '@/src/theme/theme';

const slides = [
  { title: 'Find your next vibe', body: 'A feed full of short videos picked for what you love.', icon: '▶' },
  { title: 'Make it yours', body: 'Turn everyday moments into videos, photos, and stories.', icon: '✦' },
  { title: 'Your people, closer', body: 'Follow creators, share reactions, and keep up with friends.', icon: '♡' },
];
export default function OnboardingScreen() {
  const [page, setPage] = useState(0);
  const setOnboarded = usePreferencesStore((state) => state.setOnboarded);
  const finish = async () => { await setOnboarded(); router.replace('/login'); };
  const slide = slides[page]!;
  return <View style={styles.page}><Pressable accessibilityRole="button" accessibilityLabel="Skip onboarding" onPress={() => void finish()} style={styles.skip}><Text style={styles.skipText}>Skip</Text></Pressable><View style={styles.center}><ReelindoMark size={84} /><View style={styles.art}><Text style={styles.artText}>{slide.icon}</Text></View><Text style={styles.brand}>Reelindo</Text><Text style={styles.title}>{slide.title}</Text><Text style={styles.body}>{slide.body}</Text><View style={styles.dots}>{slides.map((_, index) => <View key={index} style={[styles.dot, page === index && styles.dotActive]} />)}</View></View><View style={styles.bottom}><Button onPress={() => page < slides.length - 1 ? setPage(page + 1) : void finish()}>{page < slides.length - 1 ? 'Continue' : 'Get started'}</Button></View></View>;
}
const styles = StyleSheet.create({ page: { flex: 1, backgroundColor: '#F4F8FB', padding: 24, paddingTop: 56, paddingBottom: 32 }, skip: { alignSelf: 'flex-end', padding: 8 }, skipText: { color: '#627789', fontSize: 15 }, center: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingBottom: 20 }, art: { width: 152, height: 152, borderRadius: 76, backgroundColor: '#E3F4F2', alignItems: 'center', justifyContent: 'center', marginTop: 30, marginBottom: 28 }, artText: { color: palette.pink, fontSize: 72, fontWeight: '800' }, brand: { color: '#0E9F95', fontSize: 16, fontWeight: '800', marginBottom: 16, letterSpacing: 2 }, title: { color: '#183040', fontSize: 28, fontWeight: '800', textAlign: 'center' }, body: { color: '#627789', fontSize: 16, lineHeight: 24, textAlign: 'center', maxWidth: 320, marginTop: 12 }, dots: { flexDirection: 'row', gap: 8, marginTop: 30 }, dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#DAE5ED' }, dotActive: { width: 24, backgroundColor: '#0E9F95' }, bottom: { width: '100%' } });
