import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { ComponentRef } from 'react';
import { router } from 'expo-router';
import { Image } from 'expo-image';
import { Avatar } from '@/src/components/Avatar';
import { AppIcon } from '@/src/components/AppIcon';
import { Screen } from '@/src/components/Screen';
import { useTabScrollToTop } from '@/src/hooks/useTabScrollToTop';
import { getTrending, searchContent, type SocialPost, type SocialUser } from '@/src/services/api';
import { useAppTheme } from '@/src/theme/useAppTheme';

type Tab = 'top' | 'accounts' | 'videos' | 'sounds' | 'hashtags';
type SearchResults = {
  accounts: SocialUser[];
  hashtags: Array<{ id: string; name: string; postsCount: number }>;
  sounds: Array<{ id: string; title: string; artist: string | null; coverUrl: string | null; usesCount: number }>;
  posts: SocialPost[];
};
type Trending = {
  hashtags: Array<{ id: string; name: string; postsCount: number }>;
  sounds: Array<{ id: string; title: string; artist: string | null; coverUrl: string | null; usesCount: number }>;
};

const tabs: Tab[] = ['top', 'accounts', 'videos', 'sounds', 'hashtags'];

export default function ExploreTab() {
  const { colors } = useAppTheme();
  const contentScrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  useTabScrollToTop(() => contentScrollRef.current?.scrollTo({ y: 0, animated: true }));
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<Tab>('top');
  const [results, setResults] = useState<SearchResults | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [trending, setTrending] = useState<Trending | null>(null);
  const [trendingError, setTrendingError] = useState('');

  useEffect(() => {
    let active = true;
    void getTrending().then((data) => { if (active) setTrending(data); }).catch((cause: unknown) => {
      if (active) setTrendingError(cause instanceof Error ? cause.message : 'Could not load trending topics.');
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const value = query.trim();
    let active = true;
    if (!value) {
      setResults(null);
      setError('');
      setBusy(false);
      return () => { active = false; };
    }
    const timer = setTimeout(() => {
      setBusy(true);
      setError('');
      void searchContent(value, tab).then((data) => {
        if (active) setResults(data);
      }).catch((cause: unknown) => {
        if (active) {
          setResults(null);
          setError(cause instanceof Error ? cause.message : 'Search failed. Please try again.');
        }
      }).finally(() => { if (active) setBusy(false); });
    }, 300);
    return () => { active = false; clearTimeout(timer); };
  }, [query, tab]);

  const hasResults = !!results && (results.accounts.length > 0 || results.hashtags.length > 0 || results.sounds.length > 0 || results.posts.length > 0);

  return <Screen style={[styles.page, { backgroundColor: colors.background }]}>
    <View style={styles.heading}>
      <View><Text style={[styles.title, { color: colors.text }]}>Explore</Text><Text style={[styles.subtitle, { color: colors.muted }]}>Find creators, sounds and new ideas</Text></View>
      <Pressable accessibilityRole="button" accessibilityLabel="Open inbox" onPress={() => router.push('/(tabs)/inbox')} style={[styles.inboxButton, { backgroundColor: colors.surface }]}>
        <AppIcon name="send" color={colors.text} size={20} />
      </Pressable>
    </View>
    <View style={[styles.searchBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <AppIcon name="search" color={colors.muted} size={20} />
      <TextInput accessibilityLabel="Search Reelindo" placeholder="Creators, sounds, hashtags" placeholderTextColor={colors.muted} value={query} onChangeText={setQuery} style={[styles.search, { color: colors.text }]} returnKeyType="search" autoCapitalize="none" />
      {query ? <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => setQuery('')}><Text style={[styles.clear, { color: colors.muted }]}>×</Text></Pressable> : null}
    </View>
    {query.trim() ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>{tabs.map((name) =>
      <Pressable key={name} onPress={() => setTab(name)} style={[styles.tab, { backgroundColor: tab === name ? colors.text : colors.surfaceRaised }]}>
        <Text style={[styles.tabText, { color: tab === name ? colors.background : colors.muted }]}>{name[0]!.toUpperCase() + name.slice(1)}</Text>
      </Pressable>)}</ScrollView> : null}
    {busy ? <ActivityIndicator color="#0E9F95" style={styles.loading} /> : null}
    <ScrollView ref={contentScrollRef} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
      {!query.trim() ? <>
        <Text style={[styles.section, { color: colors.text }]}>Trending hashtags</Text>
        {trendingError ? <Text style={[styles.error, { color: colors.danger }]}>{trendingError}</Text> : null}
        {!trending && !trendingError ? <ActivityIndicator color="#0E9F95" style={styles.loading} /> : null}
        {trending ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.trendRow}>
          {trending.hashtags.slice(0, 12).map((tag, index) => <Pressable key={tag.id} onPress={() => router.push(`/hashtags/${tag.name}`)} style={[styles.trendCard, { backgroundColor: index % 2 ? colors.surfaceRaised : '#E3F4F2' }]}>
            <Text style={styles.trendKicker}>TRENDING · {tag.postsCount} posts</Text><Text style={[styles.trendText, { color: colors.text }]}>#{tag.name}</Text>
          </Pressable>)}
        </ScrollView> : null}
        <Text style={[styles.section, { color: colors.text }]}>Popular sounds</Text>
        {trending?.sounds.length ? trending.sounds.slice(0, 10).map((sound) => <Pressable key={sound.id} onPress={() => router.push(`/sounds/${sound.id}`)} style={[styles.soundRow, { borderBottomColor: colors.border }]}>
          <View style={[styles.soundIcon, { backgroundColor: colors.surfaceRaised }]}><Text style={[styles.musicNote, { color: colors.text }]}>♫</Text></View>
          <View style={styles.soundDetails}><Text numberOfLines={1} style={[styles.soundTitle, { color: colors.text }]}>{sound.title}</Text><Text numberOfLines={1} style={[styles.muted, { color: colors.muted }]}>{sound.artist ?? 'Original sound'} · {sound.usesCount} uses</Text></View>
          <AppIcon name="play" color={colors.muted} size={19} />
        </Pressable>) : trending && <Text style={[styles.hint, { color: colors.muted }]}>Popular sounds will show up here.</Text>}
      </> : null}
      {error ? <Text style={[styles.error, { color: colors.danger }]}>{error}</Text> : null}
      {results?.accounts.map((account) => <Pressable key={account.id} onPress={() => router.push(`/users/${account.username}`)} style={[styles.account, { borderBottomColor: colors.border }]}>
        <Avatar uri={account.avatarUrl} name={account.username} size={46} />
        <View style={styles.accountDetails}><Text style={[styles.name, { color: colors.text }]}>{account.displayName}</Text><Text style={[styles.muted, { color: colors.muted }]}>@{account.username}</Text></View>
        {account.isVerified ? <Text style={styles.verified}>✓</Text> : null}
      </Pressable>)}
      {results?.hashtags.map((tag) => <Pressable key={tag.id} onPress={() => router.push(`/hashtags/${tag.name}`)} style={[styles.resultRow, { borderBottomColor: colors.border }]}>
        <Text style={[styles.resultTitle, { color: colors.text }]}># {tag.name}</Text><Text style={[styles.muted, { color: colors.muted }]}>{tag.postsCount} posts</Text>
      </Pressable>)}
      {results?.sounds.map((sound) => <Pressable key={sound.id} onPress={() => router.push(`/sounds/${sound.id}`)} style={[styles.resultRow, { borderBottomColor: colors.border }]}>
        <Text style={[styles.resultTitle, { color: colors.text }]}>♫ {sound.title}</Text><Text style={[styles.muted, { color: colors.muted }]}>{sound.artist ?? 'Original sound'} · {sound.usesCount} uses</Text>
      </Pressable>)}
      {results?.posts.length ? <View style={styles.videoGrid}>{results.posts.map((post) => <Pressable key={post.id} accessibilityRole="button" accessibilityLabel={`Open post by ${post.user?.username ?? 'creator'}`} onPress={() => router.push(`/posts/${post.id}/comments`)} style={[styles.videoTile, { backgroundColor: colors.surfaceRaised }]}>
        {post.thumbnailUrl ? <Image source={{ uri: post.thumbnailUrl }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" /> : <View style={styles.videoFallback}><AppIcon name="play" color={colors.muted} size={27} /></View>}
        <View style={styles.videoOverlay}><Text numberOfLines={2} style={styles.videoCaption}>{post.caption || `@${post.user?.username ?? 'creator'}`}</Text><Text style={styles.videoPlays}>▶ {post.likesCount}</Text></View>
      </Pressable>)}</View> : null}
      {query.trim() && !busy && !error && results && !hasResults ? <Text style={[styles.empty, { color: colors.muted }]}>No results for “{query.trim()}”. Try another search.</Text> : null}
    </ScrollView>
  </Screen>;
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: 20, paddingTop: 14 },
  heading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 },
  title: { fontSize: 28, fontWeight: '800' },
  subtitle: { fontSize: 13, marginTop: 3 },
  inboxButton: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  searchBox: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 15, paddingHorizontal: 14 },
  search: { flex: 1, fontSize: 15, paddingVertical: 12 },
  clear: { fontSize: 24, lineHeight: 28, paddingHorizontal: 3 },
  tabs: { gap: 8, paddingVertical: 14 },
  tab: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20 },
  tabText: { fontWeight: '700', fontSize: 13 },
  loading: { margin: 14 },
  content: { paddingBottom: 30 },
  section: { fontSize: 19, fontWeight: '800', marginTop: 20, marginBottom: 10 },
  trendRow: { flexDirection: 'row', gap: 10, paddingVertical: 4 },
  trendCard: { width: 160, minHeight: 88, borderRadius: 16, padding: 13, justifyContent: 'space-between' },
  trendKicker: { color: '#8E5D50', fontSize: 9, fontWeight: '800', letterSpacing: 0.6 },
  trendText: { fontSize: 17, fontWeight: '800' },
  soundRow: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  soundIcon: { width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  musicNote: { fontSize: 22 },
  soundDetails: { flex: 1 },
  soundTitle: { fontSize: 14, fontWeight: '700' },
  muted: { fontSize: 12, marginTop: 3 },
  hint: { paddingVertical: 12, fontSize: 13 },
  account: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth },
  accountDetails: { flex: 1 },
  name: { fontWeight: '700' },
  verified: { color: '#0E9F95', fontWeight: '800' },
  resultRow: { paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  resultTitle: { fontWeight: '700', marginBottom: 3 },
  videoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 3, marginTop: 5 },
  videoTile: { width: '32.7%', aspectRatio: 0.7, position: 'relative', overflow: 'hidden', borderRadius: 5 },
  videoFallback: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  videoOverlay: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 7, backgroundColor: '#0008' },
  videoCaption: { color: 'white', fontSize: 10, fontWeight: '700' },
  videoPlays: { color: 'white', fontSize: 10, marginTop: 4 },
  empty: { textAlign: 'center', padding: 28, fontSize: 14 },
  error: { marginTop: 12, textAlign: 'center', fontSize: 13 },
});
