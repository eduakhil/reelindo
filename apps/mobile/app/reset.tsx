import { useState } from 'react';
import { Link, useLocalSearchParams } from 'expo-router';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { apiRequest } from '@/src/services/api';

export default function ResetScreen() {
  const { token } = useLocalSearchParams<{ token?: string }>(); const [password, setPassword] = useState(''); const [message, setMessage] = useState(''); const [error, setError] = useState('');
  const submit = async () => { setError(''); try { const result = await apiRequest<{ message: string }>('/auth/reset', { method: 'POST', body: JSON.stringify({ token, password }) }); setMessage(result.message); } catch (e) { setError(e instanceof Error ? e.message : 'Could not reset password'); } };
  return <View style={styles.page}><Text style={styles.title}>Choose a new password</Text><TextInput accessibilityLabel="New password" secureTextEntry placeholder="New password (10+ characters)" placeholderTextColor="#627789" value={password} onChangeText={setPassword} style={styles.input} />{message ? <Text style={styles.success}>{message}</Text> : null}{error ? <Text style={styles.error}>{error}</Text> : null}<Pressable onPress={() => void submit()} disabled={!token || password.length < 10} style={[styles.button, (!token || password.length < 10) && styles.disabled]}><Text style={styles.buttonText}>Update password</Text></Pressable><Link href="/login" style={styles.link}>Return to sign in</Link></View>;
}
const styles = StyleSheet.create({ page: { flex: 1, backgroundColor: '#F4F8FB', justifyContent: 'center', padding: 24 }, title: { color: '#183040', fontSize: 27, fontWeight: '700', marginBottom: 22 }, input: { color: '#183040', backgroundColor: '#FFFFFF', borderRadius: 14, padding: 16, marginBottom: 14 }, button: { backgroundColor: '#0E9F95', borderRadius: 14, padding: 16, alignItems: 'center', marginBottom: 20 }, disabled: { opacity: 0.5 }, buttonText: { color: '#183040', fontWeight: '700' }, link: { color: '#0E9F95', textAlign: 'center' }, success: { color: '#16805D', marginBottom: 12 }, error: { color: '#B42318', marginBottom: 12 } });
