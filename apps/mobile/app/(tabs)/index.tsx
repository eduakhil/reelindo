import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated, Dimensions, Pressable, RefreshControl, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { Image } from 'expo-image';
import { VideoView, useVideoPlayer } from 'expo-video';
import * as Haptics from 'expo-haptics';
import { router, useFocusEffect } from 'expo-router';
import { Screen } from '@/src/components/Screen';
import { Avatar } from '@/src/components/Avatar';
import { useTabScrollToTop } from '@/src/hooks/useTabScrollToTop';
import { useFeedStore } from '@/src/store/feed';
import { getMyPosts, getStoryFeed, sendPostView, type FeedPost, type StoryGroup } from '@/src/services/api';
import { useAuthStore } from '@/src/store/auth';
import { usePreferencesStore } from '@/src/store/preferences';
import { getFeedVideoUrl } from '@/src/services/feed-video';
import { AppIcon } from '@/src/components/AppIcon';
import { ReelindoMark } from '@/src/components/ReelindoMark';
import { useAppTheme } from '@/src/theme/useAppTheme';

const { width: screenWidth } = Dimensions.get('window');
const MEDIA_HEIGHT = Math.min(500, Math.round(screenWidth * 1.08));
type FeedAction = (postId: string) => void;
type AppColors = ReturnType<typeof useAppTheme>['colors'];

const FeedCard = memo(function FeedCard({
  post,
  active,
  onLike,
  onSave,
  onShare,
  onComment,
  onMore,
  dataSaver,
  colors,
}: {
  post: FeedPost;
  active: boolean;
  onLike: FeedAction;
  onSave: FeedAction;
  onShare: FeedAction;
  onComment: FeedAction;
  onMore: (post: FeedPost) => void;
  dataSaver: boolean;
  colors: AppColors;
}) {
  const videoUrl = getFeedVideoUrl(post.videoUrl, dataSaver);
  const videoSource = useMemo(() => active && videoUrl ? { uri: videoUrl, useCaching: true } : null, [active, videoUrl]);
  const player = useVideoPlayer(videoSource, (video) => {
    video.loop = true;
    video.muted = false;
    video.timeUpdateEventInterval = 0.5;
    if (active && videoUrl) video.play();
  });
  const tapTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (!videoUrl) return;
    if (active && !paused) player.play();
    else player.pause();
  }, [active, paused, player, videoUrl]);

  useEffect(() => () => {
    if (tapTimeout.current) clearTimeout(tapTimeout.current);
  }, []);

  useEffect(() => {
    if (!active || !videoUrl) return;
    let watchedMs = 0;
    let previousTime: number | null = null;
    const subscription = player.addListener('timeUpdate', ({ currentTime }) => {
      if (previousTime !== null && player.playing) {
        const delta = currentTime - previousTime;
        if (delta > 0 && delta <= 2) watchedMs += delta * 1000;
      }
      previousTime = currentTime;
    });
    return () => {
      subscription.remove();
      const watchMs = Math.min(600_000, Math.round(watchedMs));
      const duration = post.duration ?? player.duration;
      if (watchMs >= 1000) {
        void sendPostView(post.id, watchMs, duration > 0 ? Math.min(100, watchMs / (duration * 1000) * 100) : 0)
          .catch((error: unknown) => console.warn('Could not record post view.', error));
      }
    };
  }, [active, player, post.duration, post.id, videoUrl]);

  const onTapMedia = () => {
    if (tapTimeout.current) {
      clearTimeout(tapTimeout.current);
      tapTimeout.current = null;
      if (!post.viewerHasLiked) onLike(post.id);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch((error: unknown) => console.warn('Could not trigger like haptic.', error));
    } else {
      tapTimeout.current = setTimeout(() => {
        tapTimeout.current = null;
        if (videoUrl) setPaused((value) => !value);
        else router.push({ pathname: '/posts/[id]', params: { id: post.id } });
      }, 280);
    }
  };

  return <View style={[styles.card, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
    <View style={styles.cardHeader}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Open @${post.user.username}'s profile`} onPress={() => router.push(`/users/${post.user.username}`)} style={styles.author}>
        <Avatar uri={post.user.avatarUrl} name={post.user.username} size={38} />
        <View style={styles.authorText}>
          <Text numberOfLines={1} style={[styles.username, { color: colors.text }]}>@{post.user.username}</Text>
          <Text numberOfLines={1} style={[styles.authorSubtext, { color: colors.muted }]}>{post.sound ? `♫ ${post.sound.title}` : 'Reelindo'}</Text>
        </View>
      </Pressable>
      {post.recommendationVariant === 'v2'
        ? <Pressable accessibilityRole="button" accessibilityLabel="More post options" onPress={() => onMore(post)} hitSlop={8} style={styles.moreButton}><Text style={[styles.moreGlyph, { color: colors.text }]}>•••</Text></Pressable>
        : null}
    </View>

    <View style={[styles.media, { backgroundColor: colors.surfaceRaised }]}>
      {active && videoUrl
        ? <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} />
        : post.thumbnailUrl
          ? <Image source={{ uri: post.thumbnailUrl }} style={StyleSheet.absoluteFill} contentFit="cover" transition={180} cachePolicy="memory-disk" />
          : <View style={[StyleSheet.absoluteFill, styles.mediaFallback, { backgroundColor: colors.surfaceRaised }]}><AppIcon name="camera" color={colors.muted} size={38} /></View>}
      <Pressable accessibilityRole="button" accessibilityLabel={videoUrl ? paused ? 'Play video' : 'Pause video' : 'Open post'} onPress={onTapMedia} style={StyleSheet.absoluteFill} />
      {paused && active && videoUrl ? <View pointerEvents="none" style={styles.paused}><Text style={styles.pauseGlyph}>Ⅱ</Text></View> : null}
      {post.type === 'REEL' ? <View pointerEvents="none" style={styles.reelBadge}><AppIcon name="play" color="white" filled size={13} /></View> : null}
    </View>

    <View style={styles.actionRow}>
      <View style={styles.actionGroup}>
        <Action colors={colors} testID="feed-like" icon={post.viewerHasLiked ? '♥' : '♡'} count={post.likesCount} label={post.viewerHasLiked ? 'Unlike' : 'Like'} active={post.viewerHasLiked} onPress={() => onLike(post.id)} />
        <Action colors={colors} testID="feed-comments" icon="▢" count={post.commentsCount} label="Comments" onPress={() => onComment(post.id)} />
        <Action colors={colors} icon="↗" count={post.sharesCount} label="Share" onPress={() => onShare(post.id)} />
      </View>
      <Action colors={colors} icon={post.viewerHasSaved ? '▣' : '▢'} count={post.viewerHasSaved ? 'Saved' : 'Save'} label={post.viewerHasSaved ? 'Remove saved post' : 'Save'} active={post.viewerHasSaved} onPress={() => onSave(post.id)} />
    </View>

    <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/posts/[id]', params: { id: post.id } })} style={styles.captionArea}>
      {post.caption ? <Text style={[styles.caption, { color: colors.text }]} numberOfLines={3}><Text style={styles.captionUsername}>@{post.user.username} </Text>{post.caption}</Text> : <Text style={[styles.caption, { color: colors.text }]}><Text style={styles.captionUsername}>@{post.user.username}</Text></Text>}
      <Text style={[styles.date, { color: colors.muted }]}>{new Date(post.createdAt).toLocaleDateString()}</Text>
    </Pressable>
  </View>;
});

function Action({ icon, count, label, onPress, active = false, testID, colors }: { icon: string; count: string | number; label: string; onPress: () => void; active?: boolean; testID?: string; colors: AppColors }) {
  return <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={styles.action}>
    <Text style={[styles.actionIcon, { color: active ? colors.accent : colors.text }]}>{icon}</Text>
    <Text style={[styles.actionCount, { color: colors.text }]}>{count}</Text>
  </Pressable>;
}

function FeedSkeleton({ colors }: { colors: AppColors }) {
  const opacity = useRef(new Animated.Value(0.45)).current;
  useEffect(() => {
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(opacity, { toValue: 0.9, duration: 650, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0.45, duration: 650, useNativeDriver: true }),
    ]));
    animation.start();
    return () => animation.stop();
  }, [opacity]);

  return <View accessibilityLabel="Loading feed" style={styles.skeleton}>
    <View style={styles.skeletonHeader}>
      <Animated.View style={[styles.skeletonAvatar, { backgroundColor: colors.surfaceRaised, opacity }]} />
      <View style={styles.skeletonUser}>
        <Animated.View style={[styles.skeletonLine, { backgroundColor: colors.surfaceRaised, opacity }]} />
        <Animated.View style={[styles.skeletonShortLine, { backgroundColor: colors.surfaceRaised, opacity }]} />
      </View>
    </View>
    <Animated.View style={[styles.skeletonMedia, { backgroundColor: colors.surfaceRaised, opacity }]} />
    <View style={styles.skeletonFooter}>
      <Animated.View style={[styles.skeletonAction, { backgroundColor: colors.surfaceRaised, opacity }]} />
      <Animated.View style={[styles.skeletonAction, { backgroundColor: colors.surfaceRaised, opacity }]} />
      <Animated.View style={[styles.skeletonAction, { backgroundColor: colors.surfaceRaised, opacity }]} />
    </View>
    <Animated.View style={[styles.skeletonLine, { backgroundColor: colors.surfaceRaised, opacity }]} />
  </View>;
}

export default function FeedTab() {
  const { colors } = useAppTheme();
  const dataSaver = usePreferencesStore((state) => state.dataSaver);
  const posts = useFeedStore((state) => state.posts);
  const loading = useFeedStore((state) => state.loading);
  const error = useFeedStore((state) => state.error);
  const load = useFeedStore((state) => state.load);
  const pendingUploadId = useFeedStore((state) => state.pendingUploadId);
  const watchUpload = useFeedStore((state) => state.watchUpload);
  const toggleLike = useFeedStore((state) => state.toggleLike);
  const toggleSave = useFeedStore((state) => state.toggleSave);
  const share = useFeedStore((state) => state.share);
  const currentUser = useAuthStore((state) => state.user);
  const feedListRef = useRef<FlashListRef<FeedPost>>(null);
  useTabScrollToTop(() => feedListRef.current?.scrollToOffset({ offset: 0, animated: true }));
  const [activeId, setActiveId] = useState<string | null>(null);
  const [stories, setStories] = useState<StoryGroup[]>([]);
  const ownStory = stories.find((group) => group.userId === currentUser?.id);

  const onLike = useCallback((id: string) => {
    void toggleLike(id).catch((cause: unknown) => Alert.alert('Could not update like', cause instanceof Error ? cause.message : 'Please try again.'));
  }, [toggleLike]);
  const onSave = useCallback((id: string) => {
    void toggleSave(id).catch((cause: unknown) => Alert.alert('Could not update saved posts', cause instanceof Error ? cause.message : 'Please try again.'));
  }, [toggleSave]);
  const onShare = useCallback((id: string) => {
    void share(id).then((url) => Share.share({ message: url })).catch((cause: unknown) => Alert.alert('Could not share post', cause instanceof Error ? cause.message : 'Please try again.'));
  }, [share]);
  const onComment = useCallback((id: string) => router.push(`/posts/${id}/comments`), []);
  const sendFeedback = useFeedStore((state) => state.feedback);
  const onMore = useCallback((post: FeedPost) => Alert.alert('Post options', 'Choose what you would like to do.', [
    { text: 'Why am I seeing this?', onPress: () => Alert.alert('Why am I seeing this?', (post.recommendationReasons ?? ['Recent public posts selected for your For You feed.']).join('\n')) },
    { text: 'Not interested', style: 'destructive', onPress: () => void sendFeedback(post.id, 'NOT_INTERESTED').catch((cause: unknown) => Alert.alert('Could not update your feed', cause instanceof Error ? cause.message : 'Please try again.')) },
    { text: 'Show me less like this', onPress: () => void sendFeedback(post.id, 'SHOW_LESS').catch((cause: unknown) => Alert.alert('Could not update your feed', cause instanceof Error ? cause.message : 'Please try again.')) },
    { text: 'Cancel', style: 'cancel' },
  ]), [sendFeedback]);

  const viewability = useRef(({ viewableItems }: { viewableItems: Array<{ item: FeedPost; isViewable: boolean }> }) => {
    setActiveId(viewableItems.find((item) => item.isViewable)?.item.id ?? null);
  });
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 55 }).current;

  useFocusEffect(useCallback(() => {
    void load(true);
    void getStoryFeed().then(setStories).catch((cause: unknown) => {
      Alert.alert('Could not load stories', cause instanceof Error ? cause.message : 'Please try again.');
    });
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    const checkUpload = async () => {
      if (!pendingUploadId || !active) return;
      attempts += 1;
      try {
        const result = await getMyPosts();
        if (!active) return;
        const uploaded = result.items.find((post) => post.id === pendingUploadId);
        if (uploaded?.status === 'READY') {
          watchUpload(null);
          void load(true);
          Alert.alert('Your Reel is live', 'Your video has finished processing and is now in your feed.');
          return;
        }
        if (uploaded?.status === 'FAILED') {
          watchUpload(null);
          Alert.alert('Reel processing failed', 'The upload is saved in your profile but could not be processed. Try uploading it again.');
          return;
        }
      } catch (cause) {
        console.warn('Could not check Reel processing status.', cause);
      }
      if (active && attempts < 90) timer = setTimeout(() => { void checkUpload(); }, 8000);
      else if (active) {
        watchUpload(null);
        Alert.alert('Reel is still processing', 'Check your profile later to see when it is ready.');
      }
    };
    if (pendingUploadId) timer = setTimeout(() => { void checkUpload(); }, 8000);
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      setActiveId(null);
    };
  }, [load, pendingUploadId, watchUpload]));
  const renderItem = useCallback(({ item }: { item: FeedPost }) => (
    <FeedCard post={item} active={item.id === activeId} onLike={onLike} onSave={onSave} onShare={onShare} onComment={onComment} onMore={onMore} dataSaver={dataSaver} colors={colors} />
  ), [activeId, colors, dataSaver, onComment, onLike, onMore, onSave, onShare]);

  return <Screen style={[styles.screen, { backgroundColor: colors.background }]}>
    <View style={[styles.header, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
      <View style={styles.brandGroup}><ReelindoMark size={29} /><Text style={[styles.brand, { color: colors.text }]}>Reelindo</Text></View>
      <Text style={[styles.feedTitle, { color: colors.accent }]}>For You</Text>
      <View style={styles.topActions}>
        <Pressable accessibilityRole="button" accessibilityLabel="Open activity" onPress={() => router.push({ pathname: '/(tabs)/inbox', params: { tab: 'activity' } })}><AppIcon name="heart" color={colors.text} size={22} /></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Open messages" onPress={() => router.push({ pathname: '/(tabs)/inbox', params: { tab: 'messages' } })}><AppIcon name="send" color={colors.text} size={21} /></Pressable>
      </View>
    </View>

    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={[styles.stories, { backgroundColor: colors.surface, borderBottomColor: colors.border }]} contentContainerStyle={styles.storyList}>
      <Pressable accessibilityRole="button" accessibilityLabel={ownStory ? 'View your story' : 'Create a story'} onPress={() => router.push(ownStory ? `/stories/${currentUser?.id}` : '/stories/create')} style={styles.storyButton}>
        <View style={styles.storyAvatar}><Avatar uri={currentUser?.avatarUrl} name={currentUser?.username ?? 'You'} size={58} storyStatus={ownStory ? 'unseen' : undefined} /><Text style={[styles.addStory, { backgroundColor: colors.accent, borderColor: colors.surface }]}>+</Text></View>
        <Text numberOfLines={1} style={[styles.storyLabel, { color: colors.text }]}>Your story</Text>
      </Pressable>
      {stories.filter((group) => group.userId !== currentUser?.id).map((group) => (
        <Pressable key={group.userId} accessibilityRole="button" accessibilityLabel={`View ${group.user.username}'s story`} onPress={() => router.push(`/stories/${group.userId}`)} style={styles.storyButton}>
          <Avatar uri={group.user.avatarUrl} name={group.user.username} size={58} storyStatus={group.hasUnviewed ? 'unseen' : 'seen'} />
          <Text numberOfLines={1} style={[styles.storyLabel, { color: colors.text }]}>{group.user.username}</Text>
        </Pressable>
      ))}
    </ScrollView>

    {error && !posts.length ? <View style={styles.message}><Text style={[styles.messageTitle, { color: colors.text }]}>Couldn’t load your feed</Text><Text style={[styles.messageBody, { color: colors.muted }]}>{error}</Text><Pressable accessibilityRole="button" onPress={() => void load(true)}><Text style={[styles.retry, { color: colors.accent }]}>Try again</Text></Pressable></View> : null}
    {loading && !posts.length ? <FeedSkeleton colors={colors} /> : null}
    {!loading || posts.length > 0 ? <FlashList
      ref={feedListRef}
      data={posts}
      testID="feed-list"
      renderItem={renderItem}
      keyExtractor={(item) => item.id}
      getItemType={(item) => item.type}
      showsVerticalScrollIndicator={false}
      onViewableItemsChanged={viewability.current}
      viewabilityConfig={viewabilityConfig}
      onEndReached={() => { if (!loading) void load(); }}
      onEndReachedThreshold={0.6}
      drawDistance={MEDIA_HEIGHT}
      refreshing={loading && posts.length > 0}
      refreshControl={<RefreshControl refreshing={loading && posts.length > 0} onRefresh={() => void load(true)} tintColor="#0E9F95" colors={['#0E9F95']} />}
      ListEmptyComponent={!loading && !error ? <View style={styles.emptyFeed}><Text style={[styles.emptyTitle, { color: colors.text }]}>Your feed starts here</Text><Text style={[styles.messageBody, { color: colors.muted }]}>Follow creators, explore posts, or share your first moment.</Text><Pressable style={[styles.exploreButton, { backgroundColor: colors.accent }]} onPress={() => router.push('/(tabs)/explore')}><Text style={styles.exploreButtonText}>Explore creators</Text></Pressable><Pressable onPress={() => router.push('/(tabs)/create')}><Text style={[styles.retry, { color: colors.accent }]}>Create a post</Text></Pressable></View> : null}
      style={styles.list}
    /> : null}
  </Screen>;
}

const styles = StyleSheet.create({
  screen: {},
  header: { height: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  brandGroup: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  brand: { fontSize: 17, fontWeight: '900' },
  feedTitle: { fontSize: 14, fontWeight: '800' },
  topActions: { flexDirection: 'row', alignItems: 'center', gap: 17 },
  stories: { maxHeight: 94, flexGrow: 0, borderBottomWidth: StyleSheet.hairlineWidth },
  storyList: { alignItems: 'center', gap: 13, paddingHorizontal: 14, paddingVertical: 8 },
  storyButton: { alignItems: 'center', width: 66 },
  storyAvatar: { position: 'relative' },
  addStory: { position: 'absolute', right: -1, bottom: -1, width: 20, height: 20, textAlign: 'center', textAlignVertical: 'center', overflow: 'hidden', borderRadius: 10, color: 'white', borderWidth: 2, fontWeight: '800' },
  storyLabel: { fontSize: 11, marginTop: 4, maxWidth: 66 },
  list: { flex: 1 },
  card: { marginBottom: 9, borderBottomWidth: StyleSheet.hairlineWidth },
  cardHeader: { minHeight: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12 },
  author: { flexDirection: 'row', alignItems: 'center', gap: 9, flex: 1 },
  authorText: { flex: 1, gap: 2 },
  username: { fontSize: 13, fontWeight: '800' },
  authorSubtext: { fontSize: 11 },
  moreButton: { width: 36, height: 40, alignItems: 'center', justifyContent: 'center' },
  moreGlyph: { fontSize: 20, fontWeight: '900' },
  media: { width: '100%', height: MEDIA_HEIGHT, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  mediaFallback: { alignItems: 'center', justifyContent: 'center' },
  reelBadge: { position: 'absolute', top: 12, right: 12, width: 25, height: 25, borderRadius: 13, backgroundColor: '#07121BA8', alignItems: 'center', justifyContent: 'center' },
  paused: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0002' },
  pauseGlyph: { color: 'white', fontSize: 44, opacity: 0.92 },
  actionRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12 },
  actionGroup: { flexDirection: 'row', alignItems: 'center', gap: 17 },
  action: { minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: 5 },
  actionIcon: { fontSize: 24 },
  actionCount: { fontSize: 12, fontWeight: '600' },
  captionArea: { paddingHorizontal: 13, paddingBottom: 11, gap: 5 },
  caption: { fontSize: 13, lineHeight: 18 },
  captionUsername: { fontWeight: '800' },
  date: { fontSize: 10, textTransform: 'uppercase' },
  message: { flex: 1, minHeight: 230, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 12 },
  messageTitle: { fontSize: 19, fontWeight: '800' },
  messageBody: { textAlign: 'center', fontSize: 13, lineHeight: 19 },
  retry: { fontWeight: '800', padding: 8 },
  emptyFeed: { minHeight: 320, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 12 },
  emptyTitle: { fontSize: 20, fontWeight: '800', textAlign: 'center' },
  exploreButton: { borderRadius: 22, paddingHorizontal: 18, paddingVertical: 11, marginTop: 4 },
  exploreButtonText: { color: 'white', fontWeight: '800' },
  skeleton: { flex: 1, paddingBottom: 12, backgroundColor: 'transparent' },
  skeletonHeader: { height: 56, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12 },
  skeletonAvatar: { width: 38, height: 38, borderRadius: 19 },
  skeletonUser: { gap: 7 },
  skeletonLine: { width: 150, height: 10, borderRadius: 5 },
  skeletonShortLine: { width: 96, height: 8, borderRadius: 4 },
  skeletonMedia: { width: '100%', height: MEDIA_HEIGHT },
  skeletonFooter: { height: 50, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12 },
  skeletonAction: { width: 64, height: 12, borderRadius: 6 },
});
