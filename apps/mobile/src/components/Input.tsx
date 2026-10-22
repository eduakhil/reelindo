import { StyleSheet, Text, TextInput, type TextInputProps, View } from 'react-native';
import { radius, spacing } from '@/src/theme/theme';
import { useAppTheme } from '@/src/theme/useAppTheme';
export function Input({ label, error, ...props }: TextInputProps & { label: string; error?: string }) {
  const { colors } = useAppTheme();
  return <View style={styles.wrap}><Text style={[styles.label, { color: colors.muted }]}>{label}</Text><TextInput accessibilityLabel={label} placeholderTextColor={colors.muted} selectionColor={colors.text} style={[styles.input, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border }]} {...props} />{error ? <Text accessibilityRole="alert" style={[styles.error, { color: colors.danger }]}>{error}</Text> : null}</View>;
}
const styles = StyleSheet.create({ wrap: { gap: spacing.sm }, label: { fontSize: 13, fontWeight: '700' }, input: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, fontSize: 16 }, error: { fontSize: 12 } });
