import { StyleSheet, Text, View } from 'react-native';
import { palette, spacing, typography } from '@/src/theme/theme';
import { useAppTheme } from '@/src/theme/useAppTheme';
export function EmptyState({ title, message, icon = '✦' }: { title: string; message: string; icon?: string }) {
  const { colors } = useAppTheme();
  return <View style={styles.container}><Text style={styles.icon}>{icon}</Text><Text style={[styles.title, { color: colors.text }]}>{title}</Text><Text style={[styles.message, { color: colors.muted }]}>{message}</Text></View>;
}
const styles = StyleSheet.create({ container: { alignItems: 'center', justifyContent: 'center', padding: spacing.xxl, gap: spacing.md }, icon: { color: palette.pink, fontSize: 34 }, title: { fontSize: typography.title, fontWeight: '700' }, message: { fontSize: typography.body, textAlign: 'center', lineHeight: 24 } });
