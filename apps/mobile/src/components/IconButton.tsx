import { Pressable, StyleSheet, Text } from 'react-native';
import { radius } from '@/src/theme/theme';
import { useAppTheme } from '@/src/theme/useAppTheme';
export function IconButton({ icon, label, onPress, selected = false }: { icon: string; label: string; onPress: () => void; selected?: boolean }) {
  const { colors } = useAppTheme();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={[styles.button, { backgroundColor: colors.surfaceRaised }]}><Text style={[styles.icon, { color: selected ? '#0E9F95' : colors.text }]}>{icon}</Text></Pressable>;
}
const styles = StyleSheet.create({ button: { width: 44, height: 44, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' }, icon: { fontSize: 21 } });
