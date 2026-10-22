import { useState } from 'react';
import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { apiRequest } from '@/src/services/api';

export default function ForgotScreen() {
  const [email, setEmail] = useState(''); const [message, setMessage] = useState(''); const [error, setError] = useState('');
  const submit = async () => { setError(''); setMessage(''); try { const result = await apiRequest<{ message: string }>('/auth/forgot', { method: 'POST', body: JSON.stringify({ email }) }); setMessage(result.message); } catch (e) { setError(e instanceof Error ? e.message : 'Request failed'); } };
  return <View style={styles.page}><Text style={styles.title}>Reset your password</Text><Text style={styles.note}>Enter your account email and we’ll send reset instructions.</Text><TextInput accessibilityLabel="Email" autoCapitalize="none" keyboardType="email-address" placeholder="Email" placeholderTextColor="#627789" value={email} onChangeText={setEmail} style={styles.input} />{message ? <Text style={styles.success}>{message}</Text> : null}{error ? <Text style={styles.error}>{error}</Text> : null}<Pressable onPress={() => void submit()} style={styles.button}><Text style={styles.buttonText}>Send instructions</Text></Pressable><Link href="/login" style={styles.link}>Back to sign in</Link></View>;
}
const styles = StyleSheet.create({ page: { flex: 1, backgroundColor: '#F4F8FB', justifyContent: 'center', padding: 24 }, title: { color: '#183040', fontSize: 28, fontWeight: '700' }, note: { color: '#627789', marginVertical: 16 }, input: { color: '#183040', backgroundColor: '#FFFFFF', borderRadius: 14, padding: 16, marginBottom: 14 }, button: { backgroundColor: '#0E9F95', borderRadius: 14, padding: 16, alignItems: 'center', marginBottom: 20 }, buttonText: { color: '#183040', fontWeight: '700' }, link: { color: '#0E9F95', textAlign: 'center' }, success: { color: '#16805D', marginBottom: 12 }, error: { color: '#B42318', marginBottom: 12 } });
