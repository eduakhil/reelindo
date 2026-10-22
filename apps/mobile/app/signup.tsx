import { useMemo, useState } from 'react';
import { Link, Redirect } from 'expo-router';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button } from '@/src/components/Button';
import { Input } from '@/src/components/Input';
import { useAuthStore } from '@/src/store/auth';
import { formatDateInput, parseBirthDate, usernameSuggestions } from '@/src/services/signup-validation';
import { useAppTheme } from '@/src/theme/useAppTheme';

type SignupForm = { email: string; username: string; displayName: string; password: string; birthDate: string };

export default function SignupScreen() {
  const register = useAuthStore((state) => state.register);
  const authenticated = useAuthStore((state) => state.authenticated);
  const [form, setForm] = useState<SignupForm>({ email: '', username: '', displayName: '', password: '', birthDate: '' });
  const [usernameEdited, setUsernameEdited] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const { colors } = useAppTheme();
  const suggestions = useMemo(() => usernameSuggestions(form.displayName), [form.displayName]);
  const birthDate = parseBirthDate(form.birthDate);
  const usernameIsValid = /^[a-zA-Z0-9._]{3,30}$/.test(form.username);
  const canSubmit = Boolean(form.displayName.trim() && usernameIsValid && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()) && form.password.length >= 10 && birthDate.isoDate);
  const update = (key: keyof SignupForm, value: string) => setForm((old) => ({ ...old, [key]: value }));

  if (authenticated) return <Redirect href="/(tabs)" />;
  const submit = async () => {
    if (!canSubmit || !birthDate.isoDate) return;
    setError('');
    setBusy(true);
    try {
      await register({ ...form, email: form.email.trim(), username: form.username.trim().toLowerCase(), displayName: form.displayName.trim(), birthDate: birthDate.isoDate });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create account.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={[styles.page, { backgroundColor: colors.background }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={[styles.eyebrow, { backgroundColor: colors.surfaceRaised }]}><Text style={styles.eyebrowText}>YOUR NEXT CHAPTER</Text></View>
        <Text style={[styles.brand, { color: colors.text }]}>Join Reelindo</Text>
        <Text style={[styles.subtitle, { color: colors.muted }]}>A little creativity goes a long way. Set up your account and find your people.</Text>

        <Input label="Display name" autoCapitalize="words" autoComplete="name" placeholder="How should we call you?" value={form.displayName} onChangeText={(value) => {
          update('displayName', value);
          if (!usernameEdited) update('username', usernameSuggestions(value)[0] ?? '');
        }} returnKeyType="next" />
        <Input label="Username" autoCapitalize="none" autoCorrect={false} autoComplete="username" placeholder="your.name" value={form.username} onChangeText={(value) => {
          setUsernameEdited(true);
          update('username', value.toLowerCase().replace(/[^a-z0-9._]/g, '').slice(0, 30));
        }} returnKeyType="next" />
        {suggestions.length > 0 ? <View style={styles.suggestions}>
          <Text style={[styles.suggestionLabel, { color: colors.muted }]}>A few ideas for your handle</Text>
          <View style={styles.chips}>{suggestions.map((suggestion) => <Button key={suggestion} variant={form.username === suggestion ? 'primary' : 'secondary'} onPress={() => { setUsernameEdited(true); update('username', suggestion); }} accessibilityLabel={`Use username ${suggestion}`} style={styles.chip}><Text style={[styles.chipText, { color: form.username === suggestion ? '#183040' : colors.text }]}>@{suggestion}</Text></Button>)}</View>
        </View> : null}
        {form.username && !usernameIsValid ? <Text style={[styles.hint, { color: colors.danger }]}>Use 3–30 letters, numbers, periods, or underscores.</Text> : null}
        <Input label="Email" autoCapitalize="none" autoCorrect={false} autoComplete="email" keyboardType="email-address" placeholder="you@example.com" value={form.email} onChangeText={(value) => update('email', value)} returnKeyType="next" />
        <Input label="Password" autoCapitalize="none" autoComplete="new-password" secureTextEntry placeholder="At least 10 characters" value={form.password} onChangeText={(value) => update('password', value)} returnKeyType="next" />
        <Input label="Date of birth" autoCapitalize="none" keyboardType="number-pad" placeholder="MM/DD/YYYY" value={form.birthDate} onChangeText={(value) => update('birthDate', formatDateInput(value))} maxLength={10} />
        <Text style={[styles.hint, { color: birthDate.error && form.birthDate ? colors.danger : colors.muted }]}>{form.birthDate ? birthDate.error ?? 'Date looks good.' : 'You must be at least 16. Your birthday is kept private.'}</Text>

        {error ? <Text accessibilityRole="alert" style={[styles.error, { color: colors.danger }]}>{error}</Text> : null}
        <Button onPress={() => void submit()} disabled={busy || !canSubmit} loading={busy} style={styles.submit}>Create account</Button>
        <Text style={[styles.footer, { color: colors.muted }]}>Already have an account? <Link href="/login" style={styles.link}>Sign in</Link></Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  content: { flexGrow: 1, padding: 24, paddingTop: 44, paddingBottom: 36, width: '100%', maxWidth: 488, alignSelf: 'center', gap: 16 },
  eyebrow: { alignSelf: 'flex-start', borderRadius: 999, paddingVertical: 7, paddingHorizontal: 12, marginBottom: 4 },
  eyebrowText: { color: '#0B827A', fontSize: 11, fontWeight: '800', letterSpacing: 1.2 },
  brand: { fontSize: 34, fontWeight: '800', letterSpacing: -1.2 },
  subtitle: { fontSize: 15, lineHeight: 23, marginTop: -8, marginBottom: 6 },
  suggestions: { gap: 8, marginTop: -7 },
  suggestionLabel: { fontSize: 12, fontWeight: '600' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: 38, paddingVertical: 7, paddingHorizontal: 12 },
  chipText: { fontSize: 13, fontWeight: '700' },
  hint: { fontSize: 12, lineHeight: 18, marginTop: -10 },
  error: { fontSize: 14, lineHeight: 20 },
  submit: { marginTop: 2 },
  footer: { textAlign: 'center', marginTop: 4 },
  link: { color: '#0B827A', fontWeight: '700' },
});
