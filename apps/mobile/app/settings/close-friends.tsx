import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { Avatar } from '@/src/components/Avatar';
import { Screen } from '@/src/components/Screen';
import { addCloseFriend, getCloseFriends, removeCloseFriend, searchContent, type CloseFriend, type SocialUser } from '@/src/services/api';
import { useAppTheme } from '@/src/theme/useAppTheme';

export default function CloseFriendsScreen() {
  const { colors } = useAppTheme();
  const [friends, setFriends] = useState<CloseFriend[]>([]);
  const [results, setResults] = useState<SocialUser[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const friendIds = useMemo(() => new Set(friends.map((friend) => friend.id)), [friends]);

  const loadFriends = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setFriends((await getCloseFriends()).items);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load Close Friends.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadFriends(); }, [loadFriends]);

  useEffect(() => {
    const value = query.trim();
    let active = true;
    if (!value) {
      setResults([]);
      return () => { active = false; };
    }
    const timer = setTimeout(() => {
      void searchContent(value, 'accounts').then((response) => {
        if (active) setResults(response.accounts);
      }).catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Could not search accounts.');
      });
    }, 300);
    return () => { active = false; clearTimeout(timer); };
  }, [query]);

  const toggleFriend = async (user: Pick<SocialUser, 'id' | 'username' | 'displayName' | 'avatarUrl'>) => {
    setBusyUserId(user.id);
    setError('');
    try {
      if (friendIds.has(user.id)) {
        await removeCloseFriend(user.id);
        setFriends((current) => current.filter((friend) => friend.id !== user.id));
      } else {
        await addCloseFriend(user.id);
        setFriends((current) => [{ ...user, createdAt: new Date().toISOString() }, ...current]);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update Close Friends.');
    } finally {
      setBusyUserId(null);
    }
  };

  const visibleResults = results.filter((account) => !account.isSelf && !friendIds.has(account.id));

  return <Screen style={[styles.page, { backgroundColor: colors.background }]}>
    <View style={[styles.header, { borderBottomColor: colors.border }]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={() => router.back()}><Text style={[styles.back, { color: colors.accent }]}>‹</Text></Pressable>
      <Text style={[styles.title, { color: colors.text }]}>Close Friends</Text>
      <View style={styles.headerSpace} />
    </View>
    <Text style={[styles.description, { color: colors.muted }]}>Only people on this list can see stories shared with Close Friends.</Text>
    <View style={[styles.search, { borderColor: colors.border, backgroundColor: colors.surface }]}>
      <TextInput
        accessibilityLabel="Search people to add to Close Friends"
        value={query}
        onChangeText={setQuery}
        placeholder="Search accounts"
        placeholderTextColor={colors.muted}
        autoCapitalize="none"
        style={[styles.input, { color: colors.text }]}
      />
    </View>
    {error ? <Text accessibilityRole="alert" style={[styles.error, { color: colors.danger }]}>{error}</Text> : null}
    {loading ? <ActivityIndicator color={colors.accent} style={styles.loading} /> : null}
    <ScrollView contentContainerStyle={styles.list}>
      {query.trim() ? <>
        <Text style={[styles.section, { color: colors.text }]}>Search results</Text>
        {visibleResults.map((account) => <PersonRow key={account.id} person={account} action="Add" busy={busyUserId === account.id} colors={colors} onPress={() => void toggleFriend(account)} />)}
        {!visibleResults.length && !loading ? <Text style={[styles.empty, { color: colors.muted }]}>No accounts to add.</Text> : null}
      </> : <>
        <Text style={[styles.section, { color: colors.text }]}>Your list · {friends.length}</Text>
        {friends.map((friend) => <PersonRow key={friend.id} person={friend} action="Remove" busy={busyUserId === friend.id} colors={colors} onPress={() => void toggleFriend(friend)} />)}
        {!friends.length && !loading ? <Text style={[styles.empty, { color: colors.muted }]}>Your Close Friends list is empty. Search for accounts above to add people.</Text> : null}
      </>}
    </ScrollView>
  </Screen>;
}

function PersonRow({ person, action, busy, colors, onPress }: {
  person: Pick<SocialUser, 'id' | 'username' | 'displayName' | 'avatarUrl'>;
  action: 'Add' | 'Remove';
  busy: boolean;
  colors: ReturnType<typeof useAppTheme>['colors'];
  onPress: () => void;
}) {
  return <View style={[styles.row, { borderBottomColor: colors.border }]}>
    <Avatar uri={person.avatarUrl} name={person.username} size={42} />
    <View style={styles.personText}>
      <Text style={[styles.name, { color: colors.text }]}>{person.displayName}</Text>
      <Text style={[styles.username, { color: colors.muted }]}>@{person.username}</Text>
    </View>
    <Pressable accessibilityRole="button" accessibilityLabel={`${action} @${person.username} ${action === 'Add' ? 'to' : 'from'} Close Friends`} disabled={busy} onPress={onPress} style={[styles.action, { borderColor: colors.border, backgroundColor: action === 'Add' ? colors.accent : colors.surfaceRaised }]}>
      {busy ? <ActivityIndicator size="small" color={action === 'Add' ? 'white' : colors.text} /> : <Text style={[styles.actionText, { color: action === 'Add' ? 'white' : colors.text }]}>{action}</Text>}
    </Pressable>
  </View>;
}

const styles = StyleSheet.create({
  page: { flex: 1, paddingHorizontal: 18 },
  header: { height: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth },
  back: { width: 36, fontSize: 30 },
  title: { fontSize: 19, fontWeight: '800' },
  headerSpace: { width: 36 },
  description: { fontSize: 13, lineHeight: 19, paddingVertical: 14 },
  search: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12 },
  input: { height: 44, fontSize: 15 },
  error: { paddingTop: 10, fontSize: 13 },
  loading: { marginTop: 18 },
  list: { paddingBottom: 28 },
  section: { fontSize: 14, fontWeight: '800', marginTop: 16, marginBottom: 4 },
  row: { minHeight: 62, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  personText: { flex: 1, gap: 2 },
  name: { fontSize: 14, fontWeight: '700' },
  username: { fontSize: 12 },
  action: { minWidth: 76, height: 34, borderRadius: 9, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  actionText: { fontSize: 12, fontWeight: '800' },
  empty: { fontSize: 13, lineHeight: 20, paddingVertical: 16 },
});
