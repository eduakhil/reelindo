import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, router } from 'expo-router';
import { Avatar } from '@/src/components/Avatar';
import { Screen } from '@/src/components/Screen';
import { getBlockedUsers, unblockUser } from '@/src/services/api';

type Blocked = { id: string; username: string; displayName: string; avatarUrl: string | null };
export default function BlockedUsersScreen() {
  const [items, setItems] = useState<Blocked[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const load = useCallback(async () => { try { setItems((await getBlockedUsers()).items); setError(''); } catch (e) { setError(e instanceof Error ? e.message : 'Could not load blocked accounts'); } finally { setLoading(false); } }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  return <Screen style={styles.page}><View style={styles.header}><Pressable onPress={() => router.back()}><Text style={styles.back}>‹</Text></Pressable><Text style={styles.title}>Blocked accounts</Text><View style={{ width: 32 }} /></View>{loading ? <ActivityIndicator color="#0E9F95" /> : <FlatList data={items} keyExtractor={(item) => item.id} ListEmptyComponent={<Text style={styles.empty}>{error || 'You have not blocked anyone.'}</Text>} renderItem={({ item }) => <View style={styles.row}><Avatar uri={item.avatarUrl} name={item.username} /><View style={styles.person}><Text style={styles.name}>{item.displayName}</Text><Text style={styles.handle}>@{item.username}</Text></View><Pressable onPress={() => void unblockUser(item.id).then(() => setItems((rows) => rows.filter((row) => row.id !== item.id))).catch((e) => setError(e.message))} style={styles.button}><Text style={styles.buttonText}>Unblock</Text></Pressable></View>} />}</Screen>;
}
const styles = StyleSheet.create({ page: { paddingHorizontal: 18 }, header: { height: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, back: { color: '#0E9F95', fontSize: 30, width: 32 }, title: { color: '#183040', fontSize: 20, fontWeight: '800' }, row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomColor: '#EAF1F5', borderBottomWidth: StyleSheet.hairlineWidth }, person: { flex: 1, gap: 4 }, name: { color: '#183040', fontWeight: '700' }, handle: { color: '#627789', fontSize: 12 }, button: { paddingVertical: 8, paddingHorizontal: 14, backgroundColor: '#EAF1F5', borderRadius: 9 }, buttonText: { color: '#183040', fontWeight: '700' }, empty: { color: '#627789', textAlign: 'center', marginTop: 50 } });
