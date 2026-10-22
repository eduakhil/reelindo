import { useEffect, useState } from 'react';
import { useLocalSearchParams, router } from 'expo-router';
import { ActivityIndicator, FlatList, Image, StyleSheet, Text, View } from 'react-native';
import { Screen } from '@/src/components/Screen';
import { apiRequest, type SocialPost } from '@/src/services/api';
export default function HashtagScreen() {
  const { name } = useLocalSearchParams<{ name: string }>(); const [data, setData] = useState<{ hashtag: { name: string; postsCount: number }; items: SocialPost[] } | null>(null); const [busy, setBusy] = useState(true);
  useEffect(() => { if (name) void apiRequest<{ hashtag: { name: string; postsCount: number }; items: SocialPost[] }>(`/hashtags/${encodeURIComponent(name)}`).then(setData).catch(() => setData(null)).finally(() => setBusy(false)); }, [name]);
  return <Screen style={styles.page}><Text onPress={() => router.back()} style={styles.back}>‹ Back</Text>{busy ? <ActivityIndicator color="#0E9F95" /> : data ? <><Text style={styles.title}>#{data.hashtag.name}</Text><Text style={styles.muted}>{data.hashtag.postsCount} posts</Text><FlatList data={data.items} numColumns={3} keyExtractor={(item) => item.id} renderItem={({ item }) => <View style={styles.tile}>{item.thumbnailUrl ? <Image source={{ uri: item.thumbnailUrl }} style={StyleSheet.absoluteFill} /> : null}<Text style={styles.play}>▶</Text></View>} /></> : <Text style={styles.muted}>Hashtag not found.</Text>}</Screen>;
}
const styles = StyleSheet.create({ page: { padding: 16 }, back: { color: '#0E9F95', paddingVertical: 10 }, title: { color: '#183040', fontSize: 28, fontWeight: '800', marginTop: 12 }, muted: { color: '#627789', marginVertical: 8 }, tile: { width: '33.33%', aspectRatio: 0.78, padding: 1, backgroundColor: '#E3F4F2' }, play: { color: '#183040', position: 'absolute', bottom: 7, right: 7 } });
