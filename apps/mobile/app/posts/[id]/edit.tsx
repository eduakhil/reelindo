import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { AppIcon } from '@/src/components/AppIcon';
import { Screen } from '@/src/components/Screen';
import { getPost, updatePost, type PostDetail } from '@/src/services/api';
import { useAuthStore } from '@/src/store/auth';
import { useAppTheme } from '@/src/theme/useAppTheme';

type Visibility = 'PUBLIC' | 'FOLLOWERS' | 'PRIVATE';

export default function EditPostScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const viewerId = useAuthStore((state) => state.user?.id);
  const isPrivateAccount = useAuthStore((state) => state.user?.isPrivate ?? false);
  const { colors } = useAppTheme();
  const [post, setPost] = useState<PostDetail | null>(null);
  const [caption, setCaption] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('PUBLIC');
  const [allowComments, setAllowComments] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError('');
    try {
      const result = await getPost(id);
      if (result.userId !== viewerId) throw new Error('You can only edit your own posts.');
      setPost(result);
      setCaption(result.caption ?? '');
      setVisibility(result.visibility ?? 'PUBLIC');
      setAllowComments(result.allowComments ?? true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load this post.'); }
    finally { setLoading(false); }
  }, [id, viewerId]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const save = async () => {
    if (!post || saving) return;
    setSaving(true);
    try {
      await updatePost(post.id, { caption: caption.trim() || null, visibility, allowComments });
      router.back();
    } catch (cause) { Alert.alert('Could not save post', cause instanceof Error ? cause.message : 'Please try again.'); }
    finally { setSaving(false); }
  };

  if (loading) return <Screen style={[styles.center, { backgroundColor: colors.background }]}><ActivityIndicator color={colors.accent} /></Screen>;
  if (!post) return <Screen style={[styles.center, { backgroundColor: colors.background }]}><Text style={[styles.error, { color: colors.text }]}>{error}</Text><Pressable accessibilityRole="button" onPress={() => void load()}><Text style={[styles.link, { color: colors.accent }]}>Try again</Text></Pressable></Screen>;

  return <Screen style={[styles.page, { backgroundColor: colors.background }]}>
    <View style={[styles.header, { borderBottomColor: colors.border }]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={() => router.back()} style={styles.headerButton}><AppIcon name="back" color={colors.text} size={22} /></Pressable>
      <Text style={[styles.title, { color: colors.text }]}>Edit post</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Save changes" disabled={saving} onPress={() => void save()} style={styles.headerButton}><Text style={[styles.save, { color: colors.accent }]}>{saving ? '…' : 'Save'}</Text></Pressable>
    </View>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={[styles.helper, { color: colors.muted }]}>Update your caption, audience, and comment settings. Your uploaded video stays unchanged.</Text>
      <TextInput accessibilityLabel="Caption" placeholder="Write a caption…" placeholderTextColor={colors.muted} value={caption} onChangeText={setCaption} maxLength={2200} multiline style={[styles.caption, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border }]} />
      <Text style={[styles.counter, { color: colors.muted }]}>{caption.length}/2200</Text>
      {isPrivateAccount ? <><Text style={[styles.label, { color: colors.text }]}>Who can see this post?</Text>
      {(['PUBLIC', 'FOLLOWERS', 'PRIVATE'] as const).map((item) => <Pressable key={item} accessibilityRole="radio" accessibilityState={{ checked: visibility === item }} onPress={() => setVisibility(item)} style={[styles.choice, { backgroundColor: colors.surface, borderColor: visibility === item ? colors.accent : colors.border }]}>
        <View style={styles.choiceCopy}><Text style={[styles.choiceTitle, { color: colors.text }]}>{item === 'PUBLIC' ? 'Everyone' : item === 'FOLLOWERS' ? 'Followers' : 'Only me'}</Text><Text style={[styles.choiceDescription, { color: colors.muted }]}>{item === 'PUBLIC' ? 'Anyone can view this post.' : item === 'FOLLOWERS' ? 'Only approved followers can view this post.' : 'Only you can view this post.'}</Text></View>
        <View style={[styles.radio, { borderColor: visibility === item ? colors.accent : colors.border }]}>{visibility === item ? <View style={[styles.radioSelected, { backgroundColor: colors.accent }]} /> : null}</View>
      </Pressable>)}</> : <View style={[styles.publicNotice, { backgroundColor: colors.surface }]}><Text style={[styles.choiceDescription, { color: colors.text }]}>Public account: posts and videos are shared with everyone.</Text></View>}
      <View style={[styles.commentRow, { borderTopColor: colors.border }]}><View><Text style={[styles.label, { color: colors.text }]}>Comments</Text><Text style={[styles.choiceDescription, { color: colors.muted }]}>Allow people to comment on this post.</Text></View><Switch value={allowComments} onValueChange={setAllowComments} trackColor={{ true: colors.accent }} /></View>
    </ScrollView>
  </Screen>;
}

const styles = StyleSheet.create({
  page: { flex: 1, paddingHorizontal: 18 },
  center: { alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  header: { height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth },
  headerButton: { width: 56, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 17, fontWeight: '800' },
  save: { fontSize: 14, fontWeight: '800' },
  content: { paddingTop: 18, paddingBottom: 30, gap: 12 },
  helper: { fontSize: 13, lineHeight: 19, marginBottom: 4 },
  caption: { minHeight: 110, borderWidth: 1, borderRadius: 12, padding: 13, textAlignVertical: 'top', fontSize: 15 },
  counter: { textAlign: 'right', fontSize: 11, marginTop: -8 },
  label: { fontSize: 14, fontWeight: '800' },
  choice: { minHeight: 68, borderWidth: 1, borderRadius: 12, paddingHorizontal: 13, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  choiceCopy: { flex: 1, gap: 4 },
  choiceTitle: { fontSize: 14, fontWeight: '700' },
  choiceDescription: { fontSize: 12, lineHeight: 17 },
  publicNotice: { padding: 13, borderRadius: 12 },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginLeft: 12 },
  radioSelected: { width: 10, height: 10, borderRadius: 5 },
  commentRow: { minHeight: 64, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, paddingTop: 12 },
  error: { fontSize: 15, textAlign: 'center' },
  link: { fontSize: 14, fontWeight: '700' },
});
