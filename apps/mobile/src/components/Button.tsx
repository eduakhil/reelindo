import type { PropsWithChildren } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, type PressableProps } from 'react-native';
import { radius, spacing } from '@/src/theme/theme';
import { useAppTheme } from '@/src/theme/useAppTheme';
type Props = PropsWithChildren<PressableProps> & { variant?: 'primary' | 'secondary' | 'ghost'; loading?: boolean; label?: string };
export function Button({ children, variant = 'primary', loading = false, label, disabled, style, ...props }: Props) {
  const { colors } = useAppTheme();
  const variantStyle = variant === 'primary' ? { backgroundColor: '#0E9F95' } : variant === 'secondary' ? { backgroundColor: colors.surfaceRaised } : { backgroundColor: 'transparent' };
  const textColor = variant === 'primary' ? '#FFFFFF' : variant === 'ghost' ? '#0B827A' : colors.text;
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled || loading} style={(state) => [styles.base, variantStyle, (state.pressed || disabled) && styles.dimmed, typeof style === 'function' ? style(state) : style]} {...props}>{loading ? <ActivityIndicator color={textColor} /> : typeof children === 'string' ? <Text style={[styles.text, { color: textColor }]}>{children}</Text> : children}</Pressable>;
}
const styles = StyleSheet.create({ base: { minHeight: 52, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderRadius: radius.pill }, text: { fontWeight: '700', fontSize: 16 }, dimmed: { opacity: 0.62 } });
