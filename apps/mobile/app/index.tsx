import { Redirect } from 'expo-router';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useAuthStore } from '@/src/store/auth';
import { usePreferencesStore } from '@/src/store/preferences';
import { ReelindoMark } from '@/src/components/ReelindoMark';

export default function Index() {
  const authenticated = useAuthStore((state) => state.authenticated);
  const ready = useAuthStore((state) => state.ready);
  const onboarded = usePreferencesStore((state) => state.onboarded);
  const preferencesReady = usePreferencesStore((state) => state.restored);
  if (!ready || !preferencesReady) return <View style={styles.loading}><ReelindoMark size={58} /><ActivityIndicator color="#0E9F95" /><Text style={styles.loadingText}>Getting your feed ready…</Text></View>;
  if (!onboarded && !authenticated) return <Redirect href="/onboarding" />;
  return <Redirect href={authenticated ? '/(tabs)' : '/login'} />;
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 18, backgroundColor: '#F4F8FB' },
  loadingText: { color: '#627789', fontSize: 14, fontWeight: '600' },
});
