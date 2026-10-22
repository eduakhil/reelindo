import { useState } from 'react';
import { Link, Redirect } from 'expo-router';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';
import { Button } from '@/src/components/Button';
import { Input } from '@/src/components/Input';
import { useAuthStore } from '@/src/store/auth';
import { useAppTheme } from '@/src/theme/useAppTheme';

export default function LoginScreen() {
  const login = useAuthStore((state) => state.login);
  const authenticated = useAuthStore((state) => state.authenticated);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const { colors } = useAppTheme();
  if (authenticated) return <Redirect href="/(tabs)" />;
  const submit = async () => {
    setError('');
    setBusy(true);
    try {
      await login(email.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign in.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <KeyboardAvoidingView style={[styles.page, { backgroundColor: colors.background }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.content}>
        <View style={[styles.eyebrow, { backgroundColor: colors.surfaceRaised }]}><Text style={styles.eyebrowText}>WATCH · CREATE · VIBE</Text></View>
        <Text style={[styles.brand, { color: colors.text }]}>Reelindo</Text>
        <Text style={[styles.heading, { color: colors.text }]}>Welcome back</Text>
        <Text style={[styles.subheading, { color: colors.muted }]}>Sign in to pick up where you left off.</Text>
        <Input testID="login-email" label="Email" autoCapitalize="none" autoCorrect={false} autoComplete="email" keyboardType="email-address" placeholder="you@example.com" value={email} onChangeText={setEmail} returnKeyType="next" />
        <Input testID="login-password" label="Password" autoCapitalize="none" autoComplete="current-password" secureTextEntry placeholder="Your password" value={password} onChangeText={setPassword} onSubmitEditing={() => void submit()} />
        {error ? <Text accessibilityRole="alert" style={[styles.error, { color: colors.danger }]}>{error}</Text> : null}
        <Button testID="login-submit" onPress={() => void submit()} disabled={busy || !email.trim() || !password} loading={busy} style={styles.submit}>Sign in</Button>
        <Link href="/forgot" style={styles.link}>Forgot password?</Link>
        <Text style={[styles.footer, { color: colors.muted }]}>New to Reelindo? <Link href="/signup" style={styles.link}>Create account</Link></Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, justifyContent: 'center', padding: 24 },
  content: { width: '100%', maxWidth: 440, alignSelf: 'center', gap: 18 },
  eyebrow: { alignSelf: 'flex-start', borderRadius: 999, paddingVertical: 7, paddingHorizontal: 12 },
  eyebrowText: { color: '#0B827A', fontSize: 11, fontWeight: '800', letterSpacing: 1.1 },
  brand: { fontSize: 40, fontWeight: '900', letterSpacing: -1.5, marginBottom: 14 },
  heading: { fontSize: 28, fontWeight: '800', letterSpacing: -0.7 },
  subheading: { fontSize: 15, marginTop: -12, marginBottom: 4 },
  error: { fontSize: 14 },
  submit: { marginTop: 4 },
  link: { color: '#0B827A', fontWeight: '700', textAlign: 'center', padding: 4 },
  footer: { textAlign: 'center', marginTop: 4 },
});
