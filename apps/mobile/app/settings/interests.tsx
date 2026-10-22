import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Screen } from '@/src/components/Screen';
import { Button } from '@/src/components/Button';
import { getFeedInterests, saveFeedInterests, type FeedInterestTopic } from '@/src/services/api';

export default function FeedInterestsScreen() {
  const [topics, setTopics] = useState<FeedInterestTopic[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { void getFeedInterests().then((result) => setTopics(result.items)).catch((reason) => setError(reason instanceof Error ? reason.message : 'Could not load interests')).finally(() => setLoading(false)); }, []);
  const toggle = (id: string) => setTopics((current) => current.map((topic) => topic.id === id ? { ...topic, selected: !topic.selected } : topic));
  const save = async () => {
    setSaving(true); setError('');
    try { const result = await saveFeedInterests(topics.filter((topic) => topic.selected).map((topic) => topic.id)); setTopics((current) => current.map((topic) => ({ ...topic, selected: result.topicIds.includes(topic.id) }))); router.back(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save interests'); }
    finally { setSaving(false); }
  };
  return <Screen style={styles.page}><ScrollView contentContainerStyle={styles.content}><View style={styles.header}><Pressable accessibilityRole="button" onPress={() => router.back()}><Text style={styles.back}>‹</Text></Pressable><Text style={styles.title}>Feed interests</Text><View style={styles.spacer} /></View><Text style={styles.description}>Choose topics to help shape your For You recommendations.</Text>{loading ? <ActivityIndicator color="#0E9F95" /> : <View style={styles.topics}>{topics.map((topic) => <Pressable key={topic.id} accessibilityRole="checkbox" accessibilityState={{ checked: topic.selected }} onPress={() => toggle(topic.id)} style={[styles.topic, topic.selected && styles.selected]}><Text style={[styles.topicText, topic.selected && styles.selectedText]}>{topic.name}</Text></Pressable>)}</View>}{error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}<Button disabled={loading || saving} loading={saving} onPress={() => void save()}>Save interests</Button></ScrollView></Screen>;
}

const styles = StyleSheet.create({ page: { backgroundColor: '#F4F8FB' }, content: { padding: 20, paddingBottom: 40 }, header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }, back: { color: '#183040', fontSize: 30, width: 32 }, title: { color: '#183040', fontSize: 21, fontWeight: '800' }, spacer: { width: 32 }, description: { color: '#627789', fontSize: 14, lineHeight: 20, marginBottom: 20 }, topics: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 24 }, topic: { borderRadius: 20, borderWidth: 1, borderColor: '#DAE5ED', backgroundColor: '#FFFFFF', paddingHorizontal: 16, paddingVertical: 10 }, selected: { borderColor: '#0E9F95', backgroundColor: '#E3F4F2' }, topicText: { color: '#627789', fontWeight: '700' }, selectedText: { color: '#183040' }, error: { color: '#B42318', marginBottom: 14 } });
