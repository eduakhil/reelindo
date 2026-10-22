import type { PropsWithChildren } from 'react';
import { StyleSheet, View, type ViewProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppTheme } from '@/src/theme/useAppTheme';
export function Screen({ children, style, ...props }: PropsWithChildren<ViewProps>) {
  const { colors } = useAppTheme();
  return <SafeAreaView edges={['top', 'left', 'right']} style={[styles.safe, { backgroundColor: colors.background }]}><View style={[styles.body, style]} {...props}>{children}</View></SafeAreaView>;
}
const styles = StyleSheet.create({ safe: { flex: 1 }, body: { flex: 1 } });
