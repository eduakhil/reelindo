import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import { Avatar } from '@/src/components/Avatar';
import { AppIcon } from '@/src/components/AppIcon';
import { Screen } from '@/src/components/Screen';
import { getConversations, getNotifications, markNotificationsRead, type ChatConversation, type InboxNotification } from '@/src/services/api';
import { useAppTheme } from '@/src/theme/useAppTheme';

type Tab = 'activity' | 'messages';
const labels: Record<string, string> = { LIKE: 'liked your post', COMMENT: 'commented on your post', FOLLOW: 'started following you', MENTION: 'mentioned you' };

export default function InboxTab() {
  const { colors } = useAppTheme();
  const { tab: requestedTab } = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<Tab>('activity');
  const [notifications, setNotifications] = useState<InboxNotification[]>([]);
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setTab(requestedTab === 'messages' ? 'messages' : 'activity');
  }, [requestedTab]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      if (tab === 'activity') {
        const data = await getNotifications();
        setNotifications(data.items);
        if (data.unreadCount) {
          await markNotificationsRead({ all: true });
          setNotifications((items) => items.map((item) => ({ ...item, isRead: true })));
        }
      } else {
        setConversations((await getConversations()).items);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load your inbox.');
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const emptyContent = tab === 'activity'
    ? <Empty title="You're all caught up" subtitle="Likes, follows, comments and mentions will show up here." colors={colors} />
    : <Empty title="Your messages live here" subtitle="Start a conversation with a creator you follow." colors={colors} action={() => router.push('/(tabs)/explore')} />;

  return <Screen style={[styles.page, { backgroundColor: colors.background }]}>
    <View style={styles.header}>
      <View><Text style={[styles.title, { color: colors.text }]}>Inbox</Text><Text style={[styles.subtitle, { color: colors.muted }]}>Your activity and conversations</Text></View>
      <Pressable accessibilityRole="button" accessibilityLabel="Find people to message" onPress={() => router.push('/(tabs)/explore')} style={[styles.compose, { backgroundColor: colors.surface }]}>
        <AppIcon name="create" color={colors.text} size={22} />
      </Pressable>
    </View>
    <View style={[styles.tabs, { backgroundColor: colors.surfaceRaised }]}>
      {(['activity', 'messages'] as const).map((name) => <Pressable key={name} accessibilityRole="tab" accessibilityState={{ selected: tab === name }} onPress={() => setTab(name)} style={[styles.tab, tab === name && [styles.selected, { backgroundColor: colors.surface }]]}>
        <Text style={[styles.tabText, { color: tab === name ? colors.text : colors.muted }]}>{name === 'activity' ? 'Activity' : 'Messages'}</Text>
      </Pressable>)}
    </View>
    {loading && !(tab === 'activity' ? notifications.length : conversations.length) && !error ? <ActivityIndicator color="#0E9F95" style={styles.spinner} /> : null}
    {error ? <Pressable accessibilityRole="button" onPress={() => void load()} style={styles.errorBox}><Text style={[styles.error, { color: colors.danger }]}>{error}</Text><Text style={styles.retry}>Tap to retry</Text></Pressable> : null}
    {tab === 'activity' ? <FlatList
      data={notifications}
      keyExtractor={(item) => item.id}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} tintColor="#0E9F95" colors={['#0E9F95']} />}
      contentContainerStyle={notifications.length ? styles.list : styles.emptyList}
      ListEmptyComponent={!loading && !error ? emptyContent : undefined}
      renderItem={({ item }) => <Pressable accessibilityRole="button" onPress={() => {
        if (item.post) router.push(`/posts/${item.post.id}/comments`);
        else if (item.actor) router.push(`/users/${item.actor.username}`);
      }} style={[styles.row, { borderBottomColor: colors.border }]}>
        <View><Avatar uri={item.actor?.avatarUrl} name={item.actor?.username ?? 'Reelindo'} size={46} />{!item.isRead ? <View style={styles.unreadDot} /> : null}</View>
        <Text style={[styles.body, { color: colors.text }]}><Text style={styles.bold}>{item.actor?.username ?? 'Someone'} </Text>{labels[item.type] ?? 'interacted with you'}{item.comment ? `: “${item.comment.text}”` : ''}<Text style={[styles.time, { color: colors.muted }]}> · {new Date(item.createdAt).toLocaleDateString()}</Text></Text>
        {item.post?.thumbnailUrl ? <Image source={{ uri: item.post.thumbnailUrl }} style={styles.thumb} contentFit="cover" /> : null}
      </Pressable>}
    /> : <FlatList
      data={conversations}
      keyExtractor={(item) => item.id}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} tintColor="#0E9F95" colors={['#0E9F95']} />}
      contentContainerStyle={conversations.length ? styles.list : styles.emptyList}
      ListEmptyComponent={!loading && !error ? emptyContent : undefined}
      renderItem={({ item }) => <Pressable accessibilityRole="button" style={[styles.row, { borderBottomColor: colors.border }]} onPress={() => router.push(`/chat/${item.id}`)}>
        <Avatar uri={item.peer?.avatarUrl} name={item.peer?.username ?? 'User'} size={49} />
        <View style={styles.conversation}><Text style={[styles.conversationName, { color: colors.text }]}>{item.peer?.displayName ?? item.peer?.username ?? 'Conversation'}</Text>
          <Text numberOfLines={1} style={[styles.preview, { color: colors.muted }]}>{item.lastMessage?.text ?? (item.lastMessage?.sharedPostId ? 'Shared a post' : 'Start a conversation')}</Text>
        </View>
        <Text style={[styles.time, { color: colors.muted }]}>{item.lastMessage ? new Date(item.lastMessage.createdAt).toLocaleDateString() : ''}</Text>
      </Pressable>}
    />}
  </Screen>;
}

function Empty({ title, subtitle, colors, action }: { title: string; subtitle: string; colors: ReturnType<typeof useAppTheme>['colors']; action?: () => void }) {
  return <View style={styles.empty}>
    <View style={[styles.emptyIcon, { backgroundColor: colors.surfaceRaised }]}><AppIcon name="inbox" color={colors.muted} size={26} /></View>
    <Text style={[styles.emptyTitle, { color: colors.text }]}>{title}</Text>
    <Text style={[styles.emptySubtitle, { color: colors.muted }]}>{subtitle}</Text>
    {action ? <Pressable accessibilityRole="button" onPress={action} style={styles.findButton}><Text style={styles.findButtonText}>Find people</Text></Pressable> : null}
  </View>;
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: 18, paddingTop: 12 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  title: { fontSize: 28, fontWeight: '800' },
  subtitle: { fontSize: 13, marginTop: 3 },
  compose: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  tabs: { flexDirection: 'row', padding: 4, borderRadius: 13, marginBottom: 8 },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 10 },
  selected: { elevation: 1 },
  tabText: { fontSize: 13, fontWeight: '800' },
  spinner: { marginTop: 45 },
  errorBox: { alignItems: 'center', paddingTop: 20 },
  error: { textAlign: 'center', fontSize: 13 },
  retry: { color: '#0E9F95', fontWeight: '700', marginTop: 7 },
  list: { paddingBottom: 20 },
  emptyList: { flexGrow: 1 },
  row: { minHeight: 74, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 10 },
  body: { flex: 1, fontSize: 13, lineHeight: 19 },
  bold: { fontWeight: '800' },
  time: { fontSize: 11 },
  unreadDot: { position: 'absolute', right: -1, bottom: 1, width: 10, height: 10, borderRadius: 5, backgroundColor: '#0E9F95', borderWidth: 1.5, borderColor: 'white' },
  thumb: { width: 46, height: 56, borderRadius: 7, backgroundColor: '#EAF1F5' },
  conversation: { flex: 1, gap: 4 },
  conversationName: { fontSize: 14, fontWeight: '800' },
  preview: { fontSize: 12 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 30, paddingVertical: 52 },
  emptyIcon: { width: 66, height: 66, borderRadius: 33, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  emptyTitle: { fontSize: 17, fontWeight: '800', textAlign: 'center' },
  emptySubtitle: { fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 6 },
  findButton: { backgroundColor: '#0E9F95', borderRadius: 10, paddingHorizontal: 17, paddingVertical: 10, marginTop: 16 },
  findButtonText: { color: 'white', fontWeight: '800', fontSize: 13 },
});
