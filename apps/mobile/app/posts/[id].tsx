import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { VideoView, useVideoPlayer } from 'expo-video';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { AppIcon } from '@/src/components/AppIcon';
import { Avatar } from '@/src/components/Avatar';
import { Screen } from '@/src/components/Screen';
import { apiRequest, deletePost, getPost, type PostDetail } from '@/src/services/api';
import { useAuthStore } from '@/src/store/auth';
import { useAppTheme } from '@/src/theme/useAppTheme';

export default function PostScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const viewerId = useAuthStore((state) => state.user?.id);
  const { colors } = useAppTheme();
  const [post, setPost] = useState<PostDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError('');
    try { setPost(await getPost(id)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load this post.'); }
    finally { setLoading(false); }
  }, [id]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  const player = useVideoPlayer(post?.type === 'REEL' ? post.videoUrl : null, (video) => { video.loop = true; video.play(); });

  const toggleLike = async () => {
    if (!post) return;
    const liked = !post.viewerHasLiked;
    setPost({ ...post, viewerHasLiked: liked, likesCount: Math.max(0, post.likesCount + (liked ? 1 : -1)) });
    try { await apiRequest(`/posts/${post.id}/like`, { method: liked ? 'POST' : 'DELETE' }); }
    catch (cause) {
      setPost({ ...post, viewerHasLiked: !liked, likesCount: post.likesCount });
      Alert.alert('Could not update like', cause instanceof Error ? cause.message : 'Please try again.');
    }
  };
  const toggleSave = async () => {
    if (!post) return;
    const saved = !post.viewerHasSaved;
    setPost({ ...post, viewerHasSaved: saved });
    try { await apiRequest(`/posts/${post.id}/save`, { method: saved ? 'POST' : 'DELETE' }); }
    catch (cause) {
      setPost({ ...post, viewerHasSaved: !saved });
      Alert.alert('Could not update saved posts', cause instanceof Error ? cause.message : 'Please try again.');
    }
  };
  const sharePost = async () => {
    if (!post) return;
    try {
      const { shareUrl } = await apiRequest<{ shareUrl: string }>(`/posts/${post.id}/share`, { method: 'POST' });
      await Share.share({ message: shareUrl });
    } catch (cause) { Alert.alert('Could not share post', cause instanceof Error ? cause.message : 'Please try again.'); }
  };
  const confirmDelete = () => {
    if (!post || deleting) return;
    Alert.alert('Delete post?', 'This removes the post from your profile and feed. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          setDeleting(true);
          void deletePost(post.id).then((result) => {
            router.back();
            if (result.mediaCleanup !== 'complete') {
              Alert.alert('Post deleted', result.mediaCleanup === 'failed'
                ? 'The post was deleted, but its media could not be removed from storage.'
                : 'The post was deleted, but storage is not configured to remove its media.');
            }
          }).catch((cause: unknown) => {
            Alert.alert('Could not delete post', cause instanceof Error ? cause.message : 'Please try again.');
          }).finally(() => setDeleting(false));
        },
      },
    ]);
  };

  if (loading && !post) return <Screen style={[styles.center, { backgroundColor: colors.background }]}><ActivityIndicator color={colors.accent} /></Screen>;
  if (!post) return <Screen style={[styles.center, { backgroundColor: colors.background }]}><Text style={[styles.error, { color: colors.text }]}>{error || 'Post not found'}</Text><Pressable onPress={() => void load()}><Text style={[styles.link, { color: colors.accent }]}>Try again</Text></Pressable></Screen>;
  const isOwner = post.userId === viewerId;
  const photoUri = post.media?.[0]?.url ?? post.thumbnailUrl;
  return <Screen style={[styles.page, { backgroundColor: colors.background }]}>
    <View style={[styles.header, { borderBottomColor: colors.border }]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={() => router.back()} style={styles.headerButton}><AppIcon name="back" color={colors.text} size={22} /></Pressable>
      <Text style={[styles.headerTitle, { color: colors.text }]}>Post</Text>
      {isOwner ? <View style={styles.ownerActions}>
        <Pressable accessibilityRole="button" accessibilityLabel="Delete post" disabled={deleting} onPress={confirmDelete} style={styles.headerButton}><Text style={[styles.deleteText, { color: colors.danger }]}>{deleting ? '…' : 'Delete'}</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Edit post" onPress={() => router.push({ pathname: '/posts/[id]/edit', params: { id: post.id } })} style={styles.headerButton}><AppIcon name="settings" color={colors.text} size={20} /></Pressable>
      </View> : <View style={styles.headerButton} />}
    </View>
    <View style={styles.author}>
      <Pressable accessibilityRole="button" onPress={() => router.push(`/users/${post.user.username}`)} style={styles.authorButton}>
        <Avatar uri={post.user.avatarUrl} name={post.user.username} size={42} />
        <View><Text style={[styles.username, { color: colors.text }]}>@{post.user.username}</Text><Text style={[styles.date, { color: colors.muted }]}>{new Date(post.createdAt).toLocaleDateString()}</Text></View>
      </Pressable>
      {isOwner ? <Pressable accessibilityRole="button" accessibilityLabel="Edit post details" onPress={() => router.push({ pathname: '/posts/[id]/edit', params: { id: post.id } })}><Text style={[styles.editLink, { color: colors.accent }]}>Edit</Text></Pressable> : null}
    </View>
    <View style={[styles.media, { backgroundColor: colors.surfaceRaised }]}>
      {post.type === 'REEL' && post.videoUrl ? <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls /> : photoUri ? <Image source={{ uri: photoUri }} style={StyleSheet.absoluteFill} contentFit="contain" cachePolicy="memory-disk" /> : <AppIcon name="camera" color={colors.muted} size={36} />}
    </View>
    {post.sound ? <Pressable accessibilityRole="button" accessibilityLabel={`Open sound ${post.sound.title}`} onPress={() => router.push(`/sounds/${post.sound!.id}`)} style={[styles.soundRow, { backgroundColor: colors.surfaceRaised }]}>
      <Text style={[styles.soundGlyph, { color: colors.accent }]}>♫</Text>
      <View style={styles.soundInfo}><Text numberOfLines={1} style={[styles.soundTitle, { color: colors.text }]}>{post.sound.title}</Text><Text numberOfLines={1} style={[styles.date, { color: colors.muted }]}>{post.sound.artist ?? 'Original sound'}</Text></View>
      <Text style={[styles.soundLink, { color: colors.accent }]}>View sound</Text>
    </Pressable> : null}
    <View style={styles.actions}>
      <Pressable accessibilityRole="button" accessibilityLabel={post.viewerHasLiked ? 'Unlike post' : 'Like post'} onPress={() => void toggleLike()} style={styles.action}><AppIcon name="heart" color={post.viewerHasLiked ? colors.danger : colors.text} filled={post.viewerHasLiked} size={23} /><Text style={[styles.actionText, { color: colors.text }]}>{post.likesCount}</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Open comments" onPress={() => router.push(`/posts/${post.id}/comments`)} style={styles.action}><AppIcon name="comment" color={colors.text} size={22} /><Text style={[styles.actionText, { color: colors.text }]}>{post.commentsCount}</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={post.viewerHasSaved ? 'Remove from saved' : 'Save post'} onPress={() => void toggleSave()} style={styles.action}><AppIcon name="bookmark" color={post.viewerHasSaved ? colors.accent : colors.text} filled={post.viewerHasSaved} size={22} /><Text style={[styles.actionText, { color: colors.text }]}>{post.viewerHasSaved ? 'Saved' : 'Save'}</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Share post" onPress={() => void sharePost()} style={styles.action}><AppIcon name="send" color={colors.text} size={22} /><Text style={[styles.actionText, { color: colors.text }]}>Share</Text></Pressable>
    </View>
    {post.caption ? <Text style={[styles.caption, { color: colors.text }]}>{post.caption.split(/(#[\p{L}\p{N}_]+)/gu).map((part, index) => part.startsWith('#') ? <Text key={`${part}-${index}`} accessibilityRole="link" onPress={() => router.push(`/hashtags/${encodeURIComponent(part.slice(1))}`)} style={{ color: colors.accent }}>{part}</Text> : part)}</Text> : null}
    {loading ? <ActivityIndicator color={colors.accent} style={styles.refreshing} /> : null}
  </Screen>;
}

const styles = StyleSheet.create({
  page: { flex: 1, paddingHorizontal: 16 },
  center: { alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  header: { height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth },
  headerButton: { width: 40, height: 42, alignItems: 'center', justifyContent: 'center' },
  ownerActions: { flexDirection: 'row', alignItems: 'center' },
  deleteText: { fontSize: 12, fontWeight: '800' },
  headerTitle: { fontSize: 17, fontWeight: '800' },
  author: { minHeight: 62, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  authorButton: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  soundRow: { minHeight: 54, borderRadius: 10, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  soundGlyph: { fontSize: 22, fontWeight: '800' },
  soundInfo: { flex: 1 },
  soundTitle: { fontSize: 13, fontWeight: '800' },
  soundLink: { fontSize: 11, fontWeight: '700' },
  username: { fontSize: 14, fontWeight: '800' },
  date: { fontSize: 11, marginTop: 3 },
  editLink: { fontSize: 13, fontWeight: '800', padding: 10 },
  media: { flex: 1, minHeight: 240, maxHeight: '70%', borderRadius: 12, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 20, paddingVertical: 14 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  actionText: { fontSize: 13, fontWeight: '700' },
  caption: { fontSize: 14, lineHeight: 21, paddingBottom: 20 },
  error: { fontSize: 16, textAlign: 'center' },
  link: { fontSize: 14, fontWeight: '700' },
  refreshing: { marginVertical: 8 },
});
