import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, KeyboardAvoidingView, PanResponder, Platform, Pressable, Share, StyleSheet, Text, TextInput, View, type TextStyle } from 'react-native';
import { Image } from 'expo-image';
import { VideoView, useVideoPlayer } from 'expo-video';
import Svg, { Polyline, Text as SvgText } from 'react-native-svg';
import { router, useLocalSearchParams } from 'expo-router';
import { Avatar } from '@/src/components/Avatar';
import { AppIcon } from '@/src/components/AppIcon';
import { deleteStory, getStoryFeed, getStoryViewers, sendMessage, startConversation, submitReport, viewStory, type StoryGroup, type StoryItem } from '@/src/services/api';
import { useAuthStore } from '@/src/store/auth';

const STORY_DURATION_MS = 5000;
const storyTextStyles: Record<StoryItem['textStyle'], TextStyle> = {
  BOLD: { fontWeight: '900', textShadowColor: '#000A', textShadowRadius: 7 },
  SERIF: { fontFamily: 'serif', fontWeight: '700', textShadowColor: '#000A', textShadowRadius: 7 },
  TYPEWRITER: { fontFamily: 'monospace', fontWeight: '700', textShadowColor: '#000A', textShadowRadius: 7 },
  NEON: { fontWeight: '900', textShadowColor: '#42F5D7', textShadowRadius: 14 },
};
const storyFilters: Record<StoryItem['filter'], string> = {
  NONE: 'transparent',
  WARM: '#FF9B4A26',
  COOL: '#4F9BFF30',
  DREAM: '#D995FF26',
};

export default function StoryViewerScreen() {
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const currentUserId = useAuthStore((state) => state.user?.id);
  const [groups, setGroups] = useState<StoryGroup[]>([]);
  const [groupIndex, setGroupIndex] = useState(0);
  const [storyIndex, setStoryIndex] = useState(0);
  const [error, setError] = useState('');
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const progress = useRef(new Animated.Value(0)).current;
  const progressAnimation = useRef<Animated.CompositeAnimation | null>(null);
  const remainingDuration = useRef(STORY_DURATION_MS);

  useEffect(() => {
    let active = true;
    void getStoryFeed().then((items) => {
      if (!active) return;
      const initialIndex = items.findIndex((item) => item.userId === userId);
      if (initialIndex < 0) {
        setError('This story is unavailable or has expired.');
        return;
      }
      const initialGroup = items[initialIndex];
      if (!initialGroup) {
        setError('This story is unavailable or has expired.');
        return;
      }
      const initialStoryIndex = initialGroup.stories.findIndex((item) => !item.viewerHasViewed);
      setGroups(items);
      setGroupIndex(initialIndex);
      setStoryIndex(initialStoryIndex < 0 ? 0 : initialStoryIndex);
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : 'Could not load story.');
    });
    return () => { active = false; };
  }, [userId]);

  const group = groups[groupIndex] ?? null;
  const story = group?.stories[storyIndex];
  const player = useVideoPlayer(story?.mediaType === 'VIDEO' ? story.mediaUrl : null, (video) => { video.loop = false; });
  const musicPlayer = useVideoPlayer(story?.sound?.audioUrl ?? null, (audio) => { audio.loop = true; audio.muted = false; });

  const next = useCallback(() => {
    if (!group) return;
    if (storyIndex + 1 < group.stories.length) {
      setStoryIndex((value) => value + 1);
    } else if (groupIndex + 1 < groups.length) {
      setGroupIndex((value) => value + 1);
      setStoryIndex(0);
    } else {
      router.back();
    }
  }, [group, groupIndex, groups.length, storyIndex]);

  const previous = useCallback(() => {
    if (storyIndex > 0) {
      setStoryIndex((value) => value - 1);
    } else if (groupIndex > 0) {
      const previousGroup = groups[groupIndex - 1];
      setGroupIndex((value) => value - 1);
      setStoryIndex(previousGroup ? Math.max(0, previousGroup.stories.length - 1) : 0);
    }
  }, [groupIndex, groups, storyIndex]);

  const nextUser = useCallback(() => {
    if (groupIndex + 1 < groups.length) {
      setGroupIndex((value) => value + 1);
      setStoryIndex(0);
    } else {
      router.back();
    }
  }, [groupIndex, groups.length]);

  const previousUser = useCallback(() => {
    if (groupIndex > 0) {
      setGroupIndex((value) => value - 1);
      setStoryIndex(0);
    }
  }, [groupIndex]);

  const nextRef = useRef(next);
  nextRef.current = next;

  const startProgress = useCallback(() => {
    progressAnimation.current = Animated.timing(progress, {
      toValue: 1,
      duration: remainingDuration.current,
      useNativeDriver: false,
    });
    progressAnimation.current.start(({ finished }) => {
      if (finished) nextRef.current();
    });
  }, [progress]);

  useEffect(() => {
    if (!story) return;
    progress.setValue(0);
    remainingDuration.current = STORY_DURATION_MS;
    startProgress();
    if (story.mediaType === 'VIDEO') player.play();
    player.muted = Boolean(story.sound);
    if (story.sound) musicPlayer.play();
    else musicPlayer.pause();
    void viewStory(story.id).catch((cause: unknown) => {
      Alert.alert('Could not mark story viewed', cause instanceof Error ? cause.message : 'Please try again.');
    });
    return () => {
      progressAnimation.current?.stop();
      player.pause();
      musicPlayer.pause();
    };
  }, [musicPlayer, player, progress, startProgress, story]);

  const pauseStory = () => {
    progress.stopAnimation((value) => {
      remainingDuration.current = Math.max(1, STORY_DURATION_MS * (1 - value));
    });
    player.pause();
    musicPlayer.pause();
  };

  const resumeStory = () => {
    if (story?.mediaType === 'VIDEO') player.play();
    if (story?.sound) musicPlayer.play();
    startProgress();
  };

  const panResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) => Math.max(Math.abs(gesture.dx), Math.abs(gesture.dy)) > 18,
    onPanResponderRelease: (_event, gesture) => {
      if (gesture.dy > 80 && Math.abs(gesture.dy) > Math.abs(gesture.dx)) router.back();
      else if (gesture.dx < -60 && Math.abs(gesture.dx) > Math.abs(gesture.dy)) nextUser();
      else if (gesture.dx > 60 && Math.abs(gesture.dx) > Math.abs(gesture.dy)) previousUser();
    },
  }), [nextUser, previousUser]);

  const removeStory = () => {
    if (!story || !group) return;
    Alert.alert('Delete this story?', 'This removes the story for everyone who can view it.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          void deleteStory(story.id).then(() => {
            const remainingStories = group.stories.filter((item) => item.id !== story.id);
            if (remainingStories.length) {
              setGroups((current) => current.map((item, index) => index === groupIndex ? { ...item, stories: remainingStories } : item));
              setStoryIndex(Math.min(storyIndex, remainingStories.length - 1));
              return;
            }
            const remainingGroups = groups.filter((item) => item.userId !== group.userId);
            if (!remainingGroups.length) {
              router.back();
              return;
            }
            setGroups(remainingGroups);
            setGroupIndex(Math.min(groupIndex, remainingGroups.length - 1));
            setStoryIndex(0);
          }).catch((cause: unknown) => Alert.alert('Could not delete story', cause instanceof Error ? cause.message : 'Please try again.'));
        },
      },
    ]);
  };

  const showViewers = () => {
    if (!story) return;
    void getStoryViewers(story.id).then(({ items }) => {
      Alert.alert('Story viewers', items.length ? items.map((viewer) => `@${viewer.username}`).join('\n') : 'No views yet.');
    }).catch((cause: unknown) => Alert.alert('Could not load viewers', cause instanceof Error ? cause.message : 'Please try again.'));
  };

  const showMenu = () => {
    if (!story || !group) return;
    const owner = group.userId === currentUserId;
    Alert.alert('Story options', undefined, [
      ...(owner ? [
        { text: 'Viewers', onPress: showViewers },
        { text: 'Delete story', style: 'destructive' as const, onPress: removeStory },
      ] : [
        { text: 'Share story', onPress: () => void Share.share({ message: `A story from @${group.user.username} on Reelindo` }) },
        {
          text: 'Report story',
          style: 'destructive' as const,
          onPress: () => void submitReport({ targetType: 'STORY', targetId: story.id, reason: 'Inappropriate content' })
            .then(() => Alert.alert('Report submitted', 'Thank you for helping keep Reelindo safe.'))
            .catch((cause: unknown) => Alert.alert('Could not submit report', cause instanceof Error ? cause.message : 'Please try again.')),
        },
      ]),
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const sendReply = async (text: string) => {
    const message = text.trim();
    if (!message || !group || group.userId === currentUserId || sending) return;
    setSending(true);
    try {
      const conversation = await startConversation(group.userId);
      await sendMessage(conversation.id, message);
      setReply('');
      Alert.alert('Message sent', 'Your reply is now in your conversation.');
    } catch (cause) {
      Alert.alert('Could not send reply', cause instanceof Error ? cause.message : 'Please try again.');
    } finally {
      setSending(false);
    }
  };

  if (!story || !group) {
    return <View style={styles.loadingPage}>
      <Pressable accessibilityRole="button" accessibilityLabel="Close story" style={styles.loadingClose} onPress={() => router.back()}><Text style={styles.close}>×</Text></Pressable>
      {error ? <Text style={styles.error}>{error}</Text> : <ActivityIndicator color="#55C9BC" />}
    </View>;
  }

  const progressWidth = progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });
  const isOwnStory = group.userId === currentUserId;

  return <View style={styles.page} {...panResponder.panHandlers}>
    {story.mediaType === 'VIDEO' ? <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} /> : <Image source={{ uri: story.mediaUrl }} style={StyleSheet.absoluteFill} contentFit="cover" />}
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: storyFilters[story.filter] }]} />
    <View pointerEvents="none" style={styles.shade} />
    {story.overlays?.length ? <Svg pointerEvents="none" width="100%" height="100%" viewBox="0 0 1000 1000" preserveAspectRatio="none" style={styles.overlayCanvas}>
      {story.overlays.map((overlay, overlayIndex) => overlay.type === 'DRAW'
        ? <Polyline key={`draw-${overlayIndex}`} points={overlay.points.map((point) => `${point.x * 1000},${point.y * 1000}`).join(' ')} fill="none" stroke={overlay.color} strokeWidth={overlay.width * 1000} strokeLinecap="round" strokeLinejoin="round" />
        : <SvgText key={`sticker-${overlayIndex}`} x={overlay.x * 1000} y={overlay.y * 1000} fill="white" stroke="#0009" strokeWidth={2} fontSize={54 * overlay.scale} textAnchor="middle" alignmentBaseline="middle">{overlay.value}</SvgText>)}
    </Svg> : null}
    <View style={styles.tapRow}>
      <Pressable accessibilityRole="button" accessibilityLabel="Previous story" style={styles.tapSide} onPressIn={pauseStory} onPressOut={resumeStory} onPress={previous} />
      <Pressable accessibilityRole="button" accessibilityLabel="Next story" style={styles.tapSide} onPressIn={pauseStory} onPressOut={resumeStory} onPress={next} />
    </View>
    <View pointerEvents="none" style={styles.progressRow}>
      {group.stories.map((item, itemIndex) => <View key={item.id} style={styles.track}>
        {itemIndex < storyIndex ? <View style={[styles.fill, styles.filled]} /> : itemIndex === storyIndex ? <Animated.View style={[styles.fill, { width: progressWidth }]} /> : null}
      </View>)}
    </View>
    <View style={styles.header}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Open @${group.user.username}'s profile`} onPress={() => router.push(`/users/${group.user.username}`)}>
        <Avatar uri={group.user.avatarUrl} name={group.user.username} size={34} />
      </Pressable>
      <Text style={styles.name}>@{group.user.username}</Text>
      <Text style={styles.time}>{new Date(story.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Story options" onPress={showMenu} style={styles.headerButton}><Text style={styles.menuGlyph}>•••</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Close story" onPress={() => router.back()} style={styles.headerButton}><Text style={styles.close}>×</Text></Pressable>
    </View>
    {story.caption ? <Text pointerEvents="none" style={[styles.caption, storyTextStyles[story.textStyle]]}>{story.caption}</Text> : null}
    {story.sound ? <Pressable accessibilityRole="button" accessibilityLabel={`Open sound ${story.sound.title}`} onPress={() => router.push(`/sounds/${story.sound!.id}`)} style={styles.sound}><Text numberOfLines={1} style={styles.soundText}>♫ {story.sound.title}{story.sound.artist ? ` · ${story.sound.artist}` : ''}</Text></Pressable> : null}
    {isOwnStory ? <Pressable accessibilityRole="button" accessibilityLabel="View story viewers" onPress={showViewers} style={styles.ownerAction}><Text style={styles.ownerActionText}>Viewers</Text></Pressable> : <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.replyBar}>
      <TextInput
        accessibilityLabel={`Reply to @${group.user.username}'s story`}
        value={reply}
        onChangeText={setReply}
        onSubmitEditing={() => void sendReply(reply)}
        placeholder="Send message"
        placeholderTextColor="#FFFFFFAA"
        returnKeyType="send"
        style={styles.replyInput}
      />
      <Pressable accessibilityRole="button" accessibilityLabel="Send heart reaction" disabled={sending} onPress={() => void sendReply('❤️')} style={styles.heartButton}><AppIcon name="heart" color="white" size={24} filled /></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Send story reply" disabled={sending || !reply.trim()} onPress={() => void sendReply(reply)} style={styles.sendButton}><AppIcon name="send" color="white" size={22} /></Pressable>
    </KeyboardAvoidingView>}
  </View>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#08080B' },
  loadingPage: { flex: 1, backgroundColor: '#08080B', alignItems: 'center', justifyContent: 'center' },
  loadingClose: { position: 'absolute', top: 48, right: 18, zIndex: 2 },
  shade: { ...StyleSheet.absoluteFill, backgroundColor: '#0003' },
  overlayCanvas: { ...StyleSheet.absoluteFill },
  progressRow: { position: 'absolute', top: 54, left: 12, right: 12, flexDirection: 'row', gap: 4, zIndex: 3 },
  track: { height: 3, flex: 1, backgroundColor: '#FFFFFF66', borderRadius: 2, overflow: 'hidden' },
  fill: { height: 3, backgroundColor: 'white' },
  filled: { width: '100%' },
  header: { position: 'absolute', top: 68, left: 16, right: 14, zIndex: 4, flexDirection: 'row', alignItems: 'center', gap: 9 },
  name: { color: 'white', fontWeight: '800', fontSize: 14 },
  time: { color: '#FFFFFFB8', flex: 1, fontSize: 12 },
  headerButton: { minWidth: 28, minHeight: 38, alignItems: 'center', justifyContent: 'center' },
  menuGlyph: { color: 'white', fontSize: 18, fontWeight: '900' },
  close: { color: 'white', fontSize: 30, lineHeight: 36 },
  caption: { position: 'absolute', left: 22, right: 22, top: '42%', color: 'white', textAlign: 'center', fontSize: 30, lineHeight: 38, zIndex: 2 },
  sound: { position: 'absolute', left: 18, right: 18, bottom: 92, zIndex: 3, backgroundColor: '#07121BCC', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10 },
  soundText: { color: 'white', fontSize: 13, fontWeight: '700' },
  tapRow: { ...StyleSheet.absoluteFill, flexDirection: 'row', zIndex: 1 },
  tapSide: { flex: 1 },
  replyBar: { position: 'absolute', left: 14, right: 14, bottom: 22, zIndex: 4, flexDirection: 'row', alignItems: 'center', gap: 10 },
  replyInput: { flex: 1, minHeight: 44, borderWidth: 1, borderColor: '#FFFFFFCC', borderRadius: 24, paddingHorizontal: 16, paddingVertical: 10, color: 'white', backgroundColor: '#0003' },
  heartButton: { width: 36, height: 44, alignItems: 'center', justifyContent: 'center' },
  sendButton: { width: 34, height: 44, alignItems: 'center', justifyContent: 'center' },
  ownerAction: { position: 'absolute', bottom: 28, left: 18, zIndex: 4, padding: 10 },
  ownerActionText: { color: 'white', fontSize: 13, fontWeight: '800' },
  error: { color: 'white', textAlign: 'center', paddingHorizontal: 28 },
});
