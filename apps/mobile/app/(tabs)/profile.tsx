import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import type { ComponentRef } from 'react';
import { Redirect, router, useFocusEffect } from 'expo-router';
import { Image } from 'expo-image';
import { Avatar } from '@/src/components/Avatar';
import { AppIcon } from '@/src/components/AppIcon';
import { Screen } from '@/src/components/Screen';
import { useAuthStore } from '@/src/store/auth';
import { deletePost, getProfile, getMyPosts, getSavedPosts, retryPost, type SocialPost, type SocialUser } from '@/src/services/api';
import { useAppTheme } from '@/src/theme/useAppTheme';
import { useFeedStore } from '@/src/store/feed';
import { useTabScrollToTop } from '@/src/hooks/useTabScrollToTop';

export default function ProfileTab() {
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  useTabScrollToTop(() => scrollRef.current?.scrollTo({ y: 0, animated: true }));
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const authenticated = useAuthStore((state) => state.authenticated);
  const { colors } = useAppTheme();
  const watchUpload = useFeedStore((state) => state.watchUpload);
  const [profile, setProfile] = useState<SocialUser | null>(null);
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [savedPosts, setSavedPosts] = useState<SocialPost[]>([]);
  const [contentTab, setContentTab] = useState<'posts' | 'reels' | 'saved'>('posts');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadProfile = useCallback(async () => {
    if (!user?.username) return;
    setLoading(true);
    setError('');
    try {
      const [profileResult, postsResult, savedResult] = await Promise.allSettled([
        getProfile(user.username),
        getMyPosts(),
        getSavedPosts(),
      ]);
      if (profileResult.status === 'fulfilled') setProfile(profileResult.value);
      if (postsResult.status === 'fulfilled') setPosts(postsResult.value.items);
      if (savedResult.status === 'fulfilled') setSavedPosts(savedResult.value.items);
      const rejected = [profileResult, postsResult, savedResult].find((result) => result.status === 'rejected');
      if (rejected?.status === 'rejected') {
        setError(rejected.reason instanceof Error ? rejected.reason.message : 'Some profile content could not be loaded.');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load your profile.');
    } finally {
      setLoading(false);
    }
  }, [user?.username]);

  const confirmDelete = (post: SocialPost) => {
    Alert.alert('Delete post?', 'This removes the post from your profile and feed. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          void deletePost(post.id).then((result) => {
            setPosts((current) => current.filter((item) => item.id !== post.id));
            setSavedPosts((current) => current.filter((item) => item.id !== post.id));
            if (result.mediaCleanup !== 'complete') {
              Alert.alert('Post deleted', result.mediaCleanup === 'failed'
                ? 'The post was deleted, but its media could not be removed from storage.'
                : 'The post was deleted, but storage is not configured to remove its media.');
            }
          }).catch((cause: unknown) => {
            Alert.alert('Could not delete post', cause instanceof Error ? cause.message : 'Please try again.');
          });
        },
      },
    ]);
  };

  const retryUpload = async (post: SocialPost) => {
    try {
      const result = await retryPost(post.id);
      setPosts((current) => current.map((item) => item.id === post.id ? { ...item, status: result.status } : item));
      if (result.status === 'PROCESSING') {
        watchUpload(post.id);
        Alert.alert('Retry started', 'Your Reel is saved and processing. It will appear in your feed when ready.');
      } else if (result.status === 'READY') {
        Alert.alert('Reel is ready', 'This Reel is already available.');
        void loadProfile();
      } else {
        Alert.alert('Could not restart Reel', 'The Reel remains saved in your profile. Try again later.');
      }
    } catch (cause) {
      Alert.alert('Could not retry upload', cause instanceof Error ? cause.message : 'Please try again.');
    }
  };

  useFocusEffect(useCallback(() => { void loadProfile(); }, [loadProfile]));

  if (!authenticated) return <Redirect href="/login" />;

  const visiblePosts = contentTab === 'saved' ? savedPosts : contentTab === 'reels' ? posts.filter((post) => post.type === 'REEL') : posts;

  return <Screen style={[styles.page, { backgroundColor: colors.background }]}>
    <ScrollView ref={scrollRef} showsVerticalScrollIndicator={false} refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void loadProfile()} tintColor="#0E9F95" colors={['#0E9F95']} />} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={[styles.username, { color: colors.text }]}>{user?.username ?? 'Profile'}</Text>
        <View style={styles.headerActions}>
          <Pressable accessibilityRole="button" accessibilityLabel="Create a post" onPress={() => router.push('/(tabs)/create')} style={styles.headerButton}><AppIcon name="create" color={colors.text} size={23} /></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Open settings" onPress={() => router.push('/settings')} style={styles.headerButton}><AppIcon name="settings" color={colors.text} size={23} /></Pressable>
        </View>
      </View>
      {error ? <Pressable accessibilityRole="button" onPress={() => void loadProfile()}><Text style={[styles.error, { color: colors.danger }]}>{error}  ·  Tap to retry</Text></Pressable> : null}
      <View style={styles.profileTop}>
        <Avatar uri={profile?.avatarUrl ?? user?.avatarUrl} name={user?.username ?? 'You'} size={82} hasStory />
        <View style={styles.stats}>
          <Stat value={String(profile?.postsCount ?? posts.length)} label="Posts" colors={colors} />
          <Stat value={String(profile?.followersCount ?? 0)} label="Followers" colors={colors} />
          <Stat value={String(profile?.followingCount ?? 0)} label="Following" colors={colors} />
        </View>
      </View>
      <Text style={[styles.displayName, { color: colors.text }]}>{profile?.displayName ?? `@${user?.username ?? ''}`}</Text>
      {profile?.bio ? <Text style={[styles.bio, { color: colors.text }]}>{profile.bio}</Text> : <Text style={[styles.bioPlaceholder, { color: colors.muted }]}>Add a bio to tell people a little about yourself.</Text>}
      {profile?.website ? <Text style={styles.website}>{profile.website}</Text> : null}
      <View style={styles.actions}>
        <Pressable accessibilityRole="button" onPress={() => router.push('/profile/edit')} style={[styles.actionButton, { backgroundColor: colors.surfaceRaised }]}><Text style={[styles.actionText, { color: colors.text }]}>Edit profile</Text></Pressable>
        <Pressable accessibilityRole="button" onPress={() => router.push(`/users/${user?.username ?? ''}`)} style={[styles.actionButton, { backgroundColor: colors.surfaceRaised }]}><Text style={[styles.actionText, { color: colors.text }]}>View profile</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Share profile" onPress={() => void Share.share({ message: `Check out @${user?.username} on Reelindo` })} style={[styles.iconAction, { backgroundColor: colors.surfaceRaised }]}><AppIcon name="send" color={colors.text} size={18} /></Pressable>
      </View>
      <View style={[styles.contentTabs, { borderBottomColor: colors.border }]}>
        {(['posts', 'reels', 'saved'] as const).map((tab) => <Pressable key={tab} accessibilityRole="tab" accessibilityState={{ selected: contentTab === tab }} onPress={() => setContentTab(tab)} style={[styles.contentTab, contentTab === tab && { borderBottomColor: colors.accent, borderBottomWidth: 2 }]}>
          <AppIcon name={tab === 'posts' ? 'grid' : tab === 'reels' ? 'play' : 'bookmark'} color={contentTab === tab ? colors.accent : colors.muted} size={19} />
          <Text style={[styles.contentTabText, { color: contentTab === tab ? colors.text : colors.muted }]}>{tab === 'posts' ? 'Posts' : tab === 'reels' ? 'Reels' : 'Saved'}</Text>
        </Pressable>)}
      </View>
      {loading && visiblePosts.length === 0 ? <ActivityIndicator color={colors.accent} style={styles.loading} /> : visiblePosts.length ? <View style={styles.grid}>
        {visiblePosts.map((post) => <Pressable key={post.id} accessibilityRole="button" accessibilityLabel={`${post.status && post.status !== 'READY' ? `${post.status.toLowerCase()} ` : ''}${post.type.toLowerCase()}${post.caption ? `: ${post.caption}` : ''}`} onPress={() => {
          if (contentTab !== 'saved' && post.status && post.status !== 'READY') {
            Alert.alert(post.status === 'PROCESSING' ? 'Reel is processing' : 'Reel processing failed', post.status === 'PROCESSING' ? 'This upload is saved and will appear when processing finishes.' : 'This upload is saved in your profile. You can delete it or upload the video again.');
            return;
          }
          router.push({ pathname: '/posts/[id]', params: { id: post.id } });
        }} style={[styles.tile, { backgroundColor: colors.surfaceRaised }]}>
          {post.thumbnailUrl ? <Image source={{ uri: post.thumbnailUrl }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" /> : <View style={styles.tileFallback}><AppIcon name={post.type === 'REEL' ? 'play' : 'camera'} color={colors.muted} size={28} /></View>}
          {post.type === 'REEL' ? <View style={styles.reelMark}><AppIcon name="play" color="white" size={15} filled /></View> : null}
          {post.status === 'PROCESSING' ? <View style={styles.processing}><Text style={styles.processingText}>Processing</Text></View> : post.status === 'FAILED' ? <View style={styles.processing}><Text style={styles.processingText}>Failed</Text></View> : null}
          {contentTab !== 'saved' ? <View style={styles.tileActions}>
            {post.status === 'FAILED' ? <Pressable accessibilityRole="button" accessibilityLabel="Retry Reel processing" onPress={() => void retryUpload(post)} style={styles.retryTile}><Text style={styles.retryGlyph}>↻</Text></Pressable> : null}
            <Pressable accessibilityRole="button" accessibilityLabel={`Delete ${post.type.toLowerCase()}`} onPress={() => confirmDelete(post)} style={styles.deleteTile}><Text style={styles.deleteGlyph}>×</Text></Pressable>
          </View> : null}
        </Pressable>)}
      </View> : !loading && !error ? <View style={styles.empty}>
        <View style={[styles.emptyIcon, { borderColor: colors.border }]}><AppIcon name="camera" color={colors.text} size={28} /></View>
        <Text style={[styles.emptyTitle, { color: colors.text }]}>{contentTab === 'saved' ? 'No saved posts yet' : contentTab === 'reels' ? 'No Reels yet' : 'Share your first moment'}</Text>
        <Text style={[styles.emptyText, { color: colors.muted }]}>{contentTab === 'saved' ? 'Posts you save will appear here.' : 'Your Reels and photos will appear here.'}</Text>
        {contentTab !== 'saved' ? <Pressable accessibilityRole="button" onPress={() => router.push('/(tabs)/create')} style={[styles.createButton, { backgroundColor: colors.accent }]}><Text style={styles.createButtonText}>Create post</Text></Pressable> : null}
      </View> : null}
      <Pressable accessibilityRole="button" onPress={() => void logout()} style={[styles.logout, { backgroundColor: colors.surfaceRaised }]}><Text style={[styles.logoutText, { color: colors.danger }]}>Sign out</Text></Pressable>
    </ScrollView>
  </Screen>;
}

function Stat({ value, label, colors }: { value: string; label: string; colors: ReturnType<typeof useAppTheme>['colors'] }) {
  return <View style={styles.stat}><Text style={[styles.statValue, { color: colors.text }]}>{value}</Text><Text style={[styles.statLabel, { color: colors.muted }]}>{label}</Text></View>;
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: 18 },
  content: { paddingBottom: 30 },
  header: { height: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  username: { fontSize: 18, fontWeight: '800' },
  headerActions: { flexDirection: 'row', gap: 16 },
  headerButton: { minWidth: 30, minHeight: 40, alignItems: 'center', justifyContent: 'center' },
  error: { textAlign: 'center', paddingVertical: 8, fontSize: 13 },
  profileTop: { flexDirection: 'row', alignItems: 'center', paddingVertical: 16 },
  stats: { flex: 1, flexDirection: 'row', justifyContent: 'space-around', paddingLeft: 8 },
  stat: { alignItems: 'center', gap: 4 },
  statValue: { fontWeight: '800', fontSize: 17 },
  statLabel: { fontSize: 12 },
  displayName: { fontSize: 15, fontWeight: '800', marginTop: 2 },
  bio: { fontSize: 14, lineHeight: 20, marginTop: 5 },
  bioPlaceholder: { fontSize: 13, lineHeight: 19, marginTop: 5 },
  website: { color: '#0E9F95', fontSize: 13, fontWeight: '700', marginTop: 5 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 14, marginBottom: 18 },
  actionButton: { flex: 1, minHeight: 39, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  actionText: { fontSize: 13, fontWeight: '700' },
  iconAction: { width: 42, minHeight: 39, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  gridHeader: { height: 46, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8 },
  contentTabs: { height: 50, flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth },
  contentTab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  contentTabText: { fontSize: 12, fontWeight: '800' },
  gridLabel: { fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 2, marginHorizontal: -18, marginTop: 2 },
  tile: { width: '33%', height: 152, position: 'relative', overflow: 'hidden' },
  tileFallback: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  reelMark: { position: 'absolute', right: 7, top: 7 },
  processing: { position: 'absolute', left: 4, bottom: 4, backgroundColor: '#183040CC', borderRadius: 5, paddingHorizontal: 5, paddingVertical: 3 },
  processingText: { color: 'white', fontSize: 9, fontWeight: '700' },
  tileActions: { position: 'absolute', right: 5, top: 5, flexDirection: 'row', gap: 5 },
  deleteTile: { width: 27, height: 27, borderRadius: 14, backgroundColor: '#183040D9', alignItems: 'center', justifyContent: 'center' },
  deleteGlyph: { color: 'white', fontSize: 20, fontWeight: '700', lineHeight: 23 },
  retryTile: { width: 27, height: 27, borderRadius: 14, backgroundColor: '#183040D9', alignItems: 'center', justifyContent: 'center' },
  retryGlyph: { color: 'white', fontSize: 19, fontWeight: '800', lineHeight: 23 },
  loading: { marginVertical: 32 },
  empty: { alignItems: 'center', paddingVertical: 28, paddingHorizontal: 14 },
  emptyIcon: { width: 64, height: 64, borderWidth: 1.5, borderRadius: 32, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  emptyTitle: { fontSize: 17, fontWeight: '800' },
  emptyText: { fontSize: 13, textAlign: 'center', marginTop: 6 },
  createButton: { backgroundColor: '#0E9F95', borderRadius: 10, paddingHorizontal: 18, paddingVertical: 10, marginTop: 15 },
  createButtonText: { color: 'white', fontWeight: '800', fontSize: 13 },
  section: { fontSize: 17, fontWeight: '800', marginTop: 22, marginBottom: 10 },
  logout: { marginTop: 24, padding: 14, borderRadius: 12, alignItems: 'center' },
  logoutText: { fontWeight: '700' },
});
