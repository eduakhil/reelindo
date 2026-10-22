import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { AppIcon } from '@/src/components/AppIcon';
import { Screen } from '@/src/components/Screen';
import { useAppTheme } from '@/src/theme/useAppTheme';

export default function ReelsTab() {
  const { colors } = useAppTheme();

  return <Screen style={[styles.page, { backgroundColor: colors.background }]}>
    <View style={styles.content}>
      <View style={[styles.icon, { backgroundColor: colors.surfaceRaised }]}>
        <AppIcon name="play" color={colors.accent} size={30} filled />
      </View>
      <Text style={[styles.title, { color: colors.text }]}>Reels</Text>
      <Text style={[styles.description, { color: colors.muted }]}>Short videos from creators will appear here.</Text>
      <Pressable accessibilityRole="button" onPress={() => router.push('/(tabs)/create')} style={[styles.button, { backgroundColor: colors.accent }]}>
        <Text style={styles.buttonText}>Create a Reel</Text>
      </Pressable>
    </View>
  </Screen>;
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  icon: { width: 68, height: 68, borderRadius: 22, alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  title: { fontSize: 24, fontWeight: '700', marginBottom: 8 },
  description: { fontSize: 15, textAlign: 'center', lineHeight: 22, marginBottom: 24 },
  button: { borderRadius: 10, paddingHorizontal: 20, paddingVertical: 12 },
  buttonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
});
