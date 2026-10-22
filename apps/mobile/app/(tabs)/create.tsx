import { useEffect, useRef, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import type { ComponentRef } from 'react';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { VideoView, useVideoPlayer } from 'expo-video';
import { Button } from '@/src/components/Button';
import { Screen } from '@/src/components/Screen';
import { AppIcon } from '@/src/components/AppIcon';
import { ApiRequestError, uploadMedia, type MediaUploadSession } from '@/src/services/api';
import { useFeedStore } from '@/src/store/feed';
import { useAppTheme } from '@/src/theme/useAppTheme';
import { useCreateDraftStore, type CreateDraft } from '@/src/store/createDraft';
import { useAuthStore } from '@/src/store/auth';
import { useTabScrollToTop } from '@/src/hooks/useTabScrollToTop';

type Asset = { uri: string; fileName: string; mimeType: string; type: 'REEL' | 'PHOTO'; duration?: number; width?: number; height?: number; trimStart?: number; trimEnd?: number; coverUri?: string; soundId?: string; soundTitle?: string };
type Visibility = 'PUBLIC' | 'FOLLOWERS' | 'PRIVATE';
export default function CreateTab() {
  const { colors } = useAppTheme();
  const isPrivateAccount = useAuthStore((state) => state.user?.isPrivate ?? false);
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  useTabScrollToTop(() => scrollRef.current?.scrollTo({ y: 0, animated: true }));
  const watchUpload = useFeedStore((state) => state.watchUpload);
  const { soundId, soundTitle } = useLocalSearchParams<{ soundId?: string; soundTitle?: string }>();
  const cameraRef = useRef<CameraView>(null); const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const draft = useCreateDraftStore((state) => state.draft); const draftRestored = useCreateDraftStore((state) => state.restored); const restoreDraft = useCreateDraftStore((state) => state.restore); const saveDraftToStore = useCreateDraftStore((state) => state.saveDraft); const clearDraft = useCreateDraftStore((state) => state.clearDraft);
  const [cameraOpen, setCameraOpen] = useState(false); const [cameraMode, setCameraMode] = useState<'picture' | 'video'>('picture'); const [recording, setRecording] = useState(false); const [asset, setAsset] = useState<Asset | null>(null);
  const [editorStep, setEditorStep] = useState<2 | 3>(2);
  const [hashtagDraft, setHashtagDraft] = useState('');
  const [showDraftPrompt, setShowDraftPrompt] = useState(false);
  const [facing, setFacing] = useState<'front' | 'back'>('back'); const [torch, setTorch] = useState(false);
  const [caption, setCaption] = useState(''); const [visibility, setVisibility] = useState<Visibility>('PUBLIC'); const [allowComments, setAllowComments] = useState(true); const [busy, setBusy] = useState(false); const [progress, setProgress] = useState(''); const [uploadPercent, setUploadPercent] = useState(0); const [trimStart, setTrimStart] = useState('0'); const [trimEnd, setTrimEnd] = useState('');
  const [uploadSession, setUploadSession] = useState<{ assetUri: string; coverUri?: string; session: MediaUploadSession } | null>(null);
  const [microphonePermission, requestMicrophonePermission] = useMicrophonePermissions();
  const player = useVideoPlayer(asset?.type === 'REEL' ? asset.uri : null, (instance) => { instance.loop = true; });
  const activeSoundId = soundId ?? asset?.soundId;
  const activeSoundTitle = soundTitle ?? asset?.soundTitle;
  useEffect(() => { void restoreDraft(); }, [restoreDraft]);
  useEffect(() => { if (draftRestored) setShowDraftPrompt(Boolean(draft)); }, [draftRestored, draft]);
  const resumeDraft = () => {
    if (!draft) return;
    setAsset(draft);
    setUploadSession(null);
    setCaption(draft.caption);
    setVisibility(draft.visibility);
    setAllowComments(draft.allowComments);
    setTrimStart(String(draft.trimStart ?? 0));
    setTrimEnd(draft.trimEnd ? String(draft.trimEnd) : '');
    setEditorStep(3);
    setShowDraftPrompt(false);
  };
  const choose = async (mediaTypes: ImagePicker.MediaType[]) => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) { Alert.alert('Photo access needed', 'Allow Reelindo to access selected media to create a post.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes, allowsEditing: false, quality: 0.9, videoMaxDuration: 180, preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible });
    if (result.canceled || !result.assets[0]) return;
    const selected = result.assets[0]; const isVideo = selected.type === 'video';
    const mimeType = selected.mimeType ?? (isVideo ? 'video/mp4' : 'image/jpeg');
    const allowedTypes = isVideo ? ['video/mp4', 'video/quicktime'] : ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(mimeType)) { Alert.alert('Unsupported media format', 'Choose an MP4 or MOV video, or a JPEG, PNG, or WebP photo.'); return; }
    const maxSize = isVideo ? 300 * 1024 * 1024 : 25 * 1024 * 1024;
    if (selected.fileSize && selected.fileSize > maxSize) { Alert.alert('File is too large', isVideo ? 'Videos must be 300 MB or smaller.' : 'Photos must be 25 MB or smaller.'); return; }
    const extension = mimeType === 'video/quicktime' ? 'mov' : mimeType === 'video/mp4' ? 'mp4' : mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
    setAsset({ uri: selected.uri, fileName: `reelindo-${Date.now()}.${extension}`, mimeType, type: isVideo ? 'REEL' : 'PHOTO', duration: selected.duration ? selected.duration / 1000 : undefined, width: selected.width, height: selected.height });
    setUploadSession(null);
    setEditorStep(2);
    setCameraOpen(false);
  };
  const openCamera = async () => {
    if (!cameraPermission?.granted) { const result = await requestCameraPermission(); if (!result.granted) { Alert.alert('Camera access needed', 'Allow camera access to record a Reel or take a photo.'); return; } }
    setCameraMode('picture'); setFacing('back'); setTorch(false); setCameraOpen(true);
  };
  const takePhoto = async () => { const result = await cameraRef.current?.takePictureAsync({ quality: 0.9 }); if (result) { setAsset({ uri: result.uri, fileName: `reelindo-${Date.now()}.jpg`, mimeType: 'image/jpeg', type: 'PHOTO', width: result.width, height: result.height }); setUploadSession(null); setEditorStep(2); setCameraOpen(false); } };
  const recordVideo = async () => {
    if (recording) { cameraRef.current?.stopRecording(); setRecording(false); return; }
    if (!microphonePermission?.granted) { const result = await requestMicrophonePermission(); if (!result.granted) { Alert.alert('Microphone access needed', 'Allow microphone access to record audio with your Reel.'); return; } }
    setRecording(true);
    try { const result = await cameraRef.current?.recordAsync({ maxDuration: 180 }); if (result?.uri) { setAsset({ uri: result.uri, fileName: `reelindo-${Date.now()}.mp4`, mimeType: 'video/mp4', type: 'REEL' }); setUploadSession(null); setEditorStep(2); } }
    catch (error) { Alert.alert('Recording failed', error instanceof Error ? error.message : 'Try again.'); }
    finally { setRecording(false); setCameraOpen(false); }
  };
  const chooseCover = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) { Alert.alert('Photo access needed', 'Allow access to select a cover image.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [9, 16], quality: 0.9 });
    if (!result.canceled && result.assets[0] && asset) {
      setAsset({ ...asset, coverUri: result.assets[0].uri });
      setUploadSession((current) => current?.assetUri === asset.uri ? { assetUri: asset.uri, session: { media: current.session.media } } : null);
    }
  };
  const publish = async () => {
    if (!asset) return;
    setBusy(true); setProgress('Preparing upload…');
    let post: Awaited<ReturnType<typeof uploadMedia>>;
    try {
      const start = Number(trimStart) || 0; const end = Number(trimEnd) || asset.duration || 0;
      if (asset.type === 'REEL' && end > 0 && end <= start) throw new Error('Trim end must be after the start point');
      const reusableSession = uploadSession?.assetUri === asset.uri
        ? {
          media: uploadSession.session.media,
          ...(asset.coverUri && uploadSession.coverUri === asset.coverUri && uploadSession.session.cover ? { cover: uploadSession.session.cover } : {}),
        }
        : undefined;
      post = await uploadMedia(asset.uri, asset.fileName, asset.mimeType, asset.type, caption.trim(), isPrivateAccount ? visibility : 'PUBLIC', allowComments, asset.duration, asset.width, asset.height, (value) => { setUploadPercent(value); setProgress(`Uploading media… ${value}%`); }, start, end || undefined, asset.coverUri, soundId ?? asset.soundId, reusableSession, (session) => setUploadSession({ assetUri: asset.uri, coverUri: asset.coverUri, session }));
    } catch (error) {
      if (error instanceof ApiRequestError && error.code === 'PROCESSING_QUEUE_FAILED') {
        setProgress('Your upload is saved, but Reel processing could not start.');
        setAsset(null); setUploadSession(null); setCaption(''); setUploadPercent(0); setTrimStart('0'); setTrimEnd(''); setEditorStep(2); setHashtagDraft('');
        try { await clearDraft(); } catch (draftError) { console.warn('Could not remove the published Reel draft.', draftError); }
        Alert.alert('Upload saved', error.message, [
          { text: 'Done', style: 'cancel' },
          { text: 'Open profile', onPress: () => router.push('/(tabs)/profile') },
        ]);
        setBusy(false);
        return;
      }
      setProgress('Upload failed. Your media is still selected; tap Retry to try again.');
      Alert.alert('Upload failed', error instanceof Error ? error.message : 'Check your connection and try again.');
      setBusy(false);
      return;
    }
    if (post.status === 'PROCESSING') watchUpload(post.id);
    setProgress(post.status === 'PROCESSING' ? 'Uploaded. Your Reel is processing.' : 'Post shared!');
    if (post.status === 'READY') Alert.alert('Posted', 'Your photo is now live.');
    else if (post.status === 'FAILED') Alert.alert('Upload saved', 'Your Reel is saved in your profile, but processing failed.');
    else Alert.alert('Upload complete', 'Your Reel is processing and will appear when ready.');
    setAsset(null); setUploadSession(null); setCaption(''); setUploadPercent(0); setTrimStart('0'); setTrimEnd(''); setEditorStep(2); setHashtagDraft('');
    try { await clearDraft(); } catch (error) {
      console.warn('Could not clear the saved post draft after publishing.', error);
      Alert.alert('Post shared', 'Your post is live, but the saved draft could not be removed from this device.');
    }
    setBusy(false);
  };
  const addHashtag = (value = hashtagDraft) => {
    const tag = value.trim().replace(/^#+/, '');
    if (!tag || !/^[\p{L}\p{N}_]{1,100}$/u.test(tag)) return;
    setCaption((current) => `${current.trimEnd()}${current.trim() ? ' ' : ''}#${tag} `);
    setHashtagDraft('');
  };
  if (cameraOpen) return <View style={styles.cameraPage}><CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing={facing} mode={cameraMode} enableTorch={torch}><View style={styles.cameraControls}><View style={styles.cameraTop}><Pressable onPress={() => setCameraOpen(false)}><Text style={styles.close}>Close</Text></Pressable><View style={styles.topButtons}><Pressable onPress={() => setFacing((value) => value === 'back' ? 'front' : 'back')}><Text style={styles.close}>Flip</Text></Pressable><Pressable onPress={() => setTorch((value) => !value)}><Text style={styles.close}>{torch ? 'Flash on' : 'Flash off'}</Text></Pressable></View></View><View style={styles.cameraModeRow}><Pressable onPress={() => setCameraMode('picture')} style={[styles.modeButton, cameraMode === 'picture' && styles.modeButtonSelected]}><Text style={styles.modeText}>Photo</Text></Pressable><Pressable onPress={() => setCameraMode('video')} style={[styles.modeButton, cameraMode === 'video' && styles.modeButtonSelected]}><Text style={styles.modeText}>Video</Text></Pressable></View><View style={styles.captureRow}>{cameraMode === 'picture' ? <Pressable onPress={() => void takePhoto()} style={styles.shutter}><View style={styles.shutterInner} /></Pressable> : <Pressable onPress={() => void recordVideo()} style={[styles.record, recording && styles.recording]}><Text style={styles.recordText}>{recording ? 'Stop recording' : 'Record Reel'}</Text></Pressable>}</View></View></CameraView></View>;
  if (asset) return <Screen style={[styles.page, { backgroundColor: colors.background }]}><KeyboardAvoidingView style={styles.editor} behavior={Platform.OS === 'ios' ? 'padding' : undefined}><ScrollView ref={scrollRef} contentContainerStyle={styles.editorContent} keyboardShouldPersistTaps="handled">
    <View style={styles.editorHeader}><Pressable onPress={() => { setAsset(null); setEditorStep(2); }}><Text style={[styles.cancel, { color: colors.accent }]}>Cancel</Text></Pressable><Text style={[styles.heading, { color: colors.text }]}>{editorStep === 2 ? 'Edit media' : 'Caption & audience'}</Text><Text style={[styles.stepCount, { color: colors.muted }]}>{editorStep}/3</Text></View>
    <View accessibilityRole="progressbar" accessibilityValue={{ min: 1, max: 3, now: editorStep }} style={[styles.stepTrack, { backgroundColor: colors.surfaceRaised }]}><View style={[styles.stepFill, { backgroundColor: colors.accent, width: editorStep === 2 ? '66%' : '100%' }]} /></View>
    {asset.type === 'REEL' ? <VideoView player={player} style={styles.preview} contentFit="contain" nativeControls /> : <Image source={{ uri: asset.uri }} style={styles.preview} contentFit="contain" />}
    {editorStep === 2 ? <>
      {asset.type === 'REEL' ? <><View style={styles.trim}><Text style={[styles.label, { color: colors.text }]}>Trim video (seconds)</Text><View style={styles.trimFields}><TextInput accessibilityLabel="Trim start seconds" keyboardType="decimal-pad" value={trimStart} onChangeText={setTrimStart} placeholder="Start" placeholderTextColor={colors.muted} style={[styles.trimInput, { color: colors.text, backgroundColor: colors.surface }]} /><Text style={[styles.trimDash, { color: colors.muted }]}>to</Text><TextInput accessibilityLabel="Trim end seconds" keyboardType="decimal-pad" value={trimEnd} onChangeText={setTrimEnd} placeholder={asset.duration ? String(Math.floor(asset.duration)) : 'End'} placeholderTextColor={colors.muted} style={[styles.trimInput, { color: colors.text, backgroundColor: colors.surface }]} /></View></View><Pressable onPress={() => void chooseCover()} style={styles.coverButton}><Text style={[styles.coverText, { color: colors.accent }]}>{asset.coverUri ? 'Change cover image' : 'Choose Reel cover'}</Text>{asset.coverUri ? <Image source={{ uri: asset.coverUri }} style={styles.coverThumb} contentFit="cover" /> : null}</Pressable></> : <Text style={[styles.body, { color: colors.muted }]}>Your photo is ready to share. Continue to add a caption and choose your audience.</Text>}
      <Button onPress={() => setEditorStep(3)}>Next: caption & audience</Button>
    </> : <>
      {activeSoundId ? <Text style={[styles.soundSelected, { color: colors.accent }]}>♫ {activeSoundTitle ?? 'Selected sound'}</Text> : null}
      <TextInput accessibilityLabel="Caption" placeholder="Write a caption…" placeholderTextColor={colors.muted} value={caption} onChangeText={setCaption} multiline maxLength={2200} style={[styles.captionInput, { backgroundColor: colors.surface, color: colors.text }]} /><Text style={[styles.counter, { color: colors.muted }]}>{caption.length}/2200</Text>
      <View style={styles.hashtagRow}><TextInput accessibilityLabel="Add a hashtag" placeholder="Add a hashtag" placeholderTextColor={colors.muted} value={hashtagDraft} onChangeText={setHashtagDraft} autoCapitalize="none" returnKeyType="done" onSubmitEditing={() => addHashtag()} style={[styles.hashtagInput, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border }]} /><Pressable accessibilityRole="button" accessibilityLabel="Add hashtag to caption" onPress={() => addHashtag()} style={[styles.hashtagButton, { backgroundColor: colors.accent }]}><Text style={styles.hashtagButtonText}>Add #</Text></Pressable></View>
      <View style={styles.suggestedTags}>{['reelindo', 'moments', 'daily'].map((tag) => <Pressable key={tag} accessibilityRole="button" onPress={() => addHashtag(tag)} style={[styles.tagSuggestion, { backgroundColor: colors.surfaceRaised }]}><Text style={[styles.tagSuggestionText, { color: colors.accent }]}>#{tag}</Text></Pressable>)}</View>
      {isPrivateAccount ? <><Text style={[styles.label, { color: colors.text }]}>Who can watch this?</Text><View style={styles.privacy}>{(['PUBLIC', 'FOLLOWERS', 'PRIVATE'] as const).map((mode) => <Pressable key={mode} accessibilityRole="button" accessibilityState={{ selected: visibility === mode }} onPress={() => setVisibility(mode)} style={[styles.privacyChoice, { backgroundColor: colors.surface, borderColor: visibility === mode ? colors.accent : colors.border }, visibility === mode && styles.privacySelected]}><Text style={[styles.privacyText, { color: colors.muted }, visibility === mode && { color: colors.accent }]}>{mode === 'PUBLIC' ? 'Everyone' : mode === 'FOLLOWERS' ? 'Followers' : 'Only me'}</Text></Pressable>)}</View></> : <View accessibilityRole="text" style={[styles.publicNotice, { backgroundColor: colors.surface }]}><Text style={[styles.publicNoticeText, { color: colors.text }]}>Public account: new posts and videos are shared with everyone.</Text></View>}
      <View style={styles.commentsRow}><Text style={[styles.label, { color: colors.text }]}>Allow comments</Text><Switch value={allowComments} onValueChange={setAllowComments} trackColor={{ true: colors.accent }} /></View>
      {progress ? <Text style={[styles.progress, { color: colors.muted }]}>{progress}</Text> : null}{busy ? <View style={[styles.progressTrack, { backgroundColor: colors.surfaceRaised }]}><View style={[styles.progressFill, { width: `${uploadPercent}%`, backgroundColor: colors.accent }]} /></View> : null}
      <View style={styles.publishArea}><Button variant="secondary" disabled={busy} onPress={() => setEditorStep(2)}>Back to edit</Button><Button variant="secondary" disabled={busy} onPress={async () => { const value: CreateDraft = { ...asset, caption, visibility, allowComments, trimStart: Number(trimStart) || 0, trimEnd: trimEnd ? Number(trimEnd) : undefined, soundId: soundId ?? asset.soundId, soundTitle: soundTitle ?? asset.soundTitle }; await saveDraftToStore(value); setProgress('Draft saved on this device.'); }}>{'Save draft'}</Button><Button onPress={() => void publish()} loading={busy} disabled={busy}>{busy ? `Uploading ${uploadPercent}%` : progress.startsWith('Upload failed') ? 'Retry upload' : 'Share post'}</Button></View>
    </>}
  </ScrollView></KeyboardAvoidingView></Screen>;
  return <Screen style={[styles.page, { backgroundColor: colors.background }]}><ScrollView ref={scrollRef} contentContainerStyle={styles.createContent}>
    <View style={styles.createHeading}><Text style={[styles.title, { color: colors.text }]}>Create</Text><Text style={[styles.body, { color: colors.muted }]}>Make something worth sharing.</Text></View>
    <Pressable accessibilityRole="button" onPress={() => void openCamera()} style={styles.featureCard}>
      <View style={styles.featureCopy}><Text style={styles.featureEyebrow}>MAKE A REEL</Text><Text style={styles.featureTitle}>Capture the moment</Text><Text style={styles.featureBody}>Record a video or snap a photo.</Text></View><View style={styles.featureIcon}><AppIcon name="camera" color="white" size={30} /></View>
    </Pressable>
    <Text style={[styles.optionsTitle, { color: colors.text }]}>Start with</Text>
    {showDraftPrompt && draft ? <Pressable accessibilityRole="button" onPress={resumeDraft} style={[styles.option, styles.draftOption, { backgroundColor: colors.surface, borderColor: '#0E9F95' }]}>
      <View style={[styles.optionIcon, { backgroundColor: '#E3F4F2' }]}><AppIcon name="create" color="#0E9F95" size={21} /></View><View style={styles.optionCopy}><Text style={[styles.optionTitle, { color: colors.text }]}>Continue your saved draft</Text><Text style={[styles.optionBody, { color: colors.muted }]} numberOfLines={1}>{draft.caption || 'Finish editing your saved post'}</Text></View><Text style={[styles.chevron, { color: colors.muted }]}>›</Text>
    </Pressable> : null}
    <Pressable accessibilityRole="button" onPress={() => void choose(['videos'])} style={[styles.option, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={[styles.optionIcon, { backgroundColor: colors.surfaceRaised }]}><AppIcon name="play" color={colors.text} size={21} /></View><View style={styles.optionCopy}><Text style={[styles.optionTitle, { color: colors.text }]}>Choose a video</Text><Text style={[styles.optionBody, { color: colors.muted }]}>Upload a clip from your gallery</Text></View><Text style={[styles.chevron, { color: colors.muted }]}>›</Text>
    </Pressable>
    <Pressable accessibilityRole="button" onPress={() => void choose(['images'])} style={[styles.option, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={[styles.optionIcon, { backgroundColor: colors.surfaceRaised }]}><AppIcon name="camera" color={colors.text} size={21} /></View><View style={styles.optionCopy}><Text style={[styles.optionTitle, { color: colors.text }]}>Choose a photo</Text><Text style={[styles.optionBody, { color: colors.muted }]}>Share a still moment</Text></View><Text style={[styles.chevron, { color: colors.muted }]}>›</Text>
    </Pressable>
    <Pressable accessibilityRole="button" onPress={() => router.push('/stories/create')} style={[styles.option, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={[styles.optionIcon, { backgroundColor: colors.surfaceRaised }]}><AppIcon name="create" color={colors.text} size={21} /></View><View style={styles.optionCopy}><Text style={[styles.optionTitle, { color: colors.text }]}>Create a story</Text><Text style={[styles.optionBody, { color: colors.muted }]}>Share something that disappears</Text></View><Text style={[styles.chevron, { color: colors.muted }]}>›</Text>
    </Pressable>
    <Text style={[styles.tip, { color: colors.muted }]}>Preview your post, write a caption, choose who can see it and save a draft before sharing.</Text>
  </ScrollView></Screen>;
}
const styles = StyleSheet.create({
  page: { padding: 20 },
  createContent: { flexGrow: 1, paddingTop: 12, paddingBottom: 24 },
  createHeading: { marginBottom: 24 },
  title: { fontSize: 29, fontWeight: '900' },
  body: { fontSize: 15, lineHeight: 22, marginTop: 5 },
  featureCard: { minHeight: 176, borderRadius: 22, padding: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', overflow: 'hidden', backgroundColor: '#0E9F95' },
  featureCopy: { flex: 1, gap: 7 },
  featureEyebrow: { color: '#FFE8E3', fontSize: 10, fontWeight: '900', letterSpacing: 1.2 },
  featureTitle: { color: 'white', fontSize: 23, lineHeight: 27, fontWeight: '900', maxWidth: 190 },
  featureBody: { color: 'white', opacity: 0.9, fontSize: 13, maxWidth: 190 },
  featureIcon: { width: 58, height: 58, borderRadius: 20, backgroundColor: '#FFFFFF30', alignItems: 'center', justifyContent: 'center' },
  optionsTitle: { fontSize: 17, fontWeight: '800', marginTop: 25, marginBottom: 11 },
  option: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 15, padding: 11, marginBottom: 9 },
  draftOption: { borderWidth: 1.5 },
  optionIcon: { width: 46, height: 46, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  optionCopy: { flex: 1, gap: 3 },
  optionTitle: { fontSize: 14, fontWeight: '800' },
  optionBody: { fontSize: 12 },
  chevron: { fontSize: 25, paddingHorizontal: 5 },
  tip: { fontSize: 12, lineHeight: 18, marginTop: 8, paddingHorizontal: 2 },
  cameraPage: { flex: 1, backgroundColor: '#000' },
  cameraControls: { flex: 1, justifyContent: 'space-between', padding: 24, paddingTop: 56, paddingBottom: 56 },
  cameraTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  topButtons: { flexDirection: 'row', gap: 18 },
  close: { color: 'white', fontSize: 17, fontWeight: '700' },
  cameraModeRow: { flexDirection: 'row', justifyContent: 'center', gap: 12 },
  modeButton: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 20, backgroundColor: '#222A' },
  modeButtonSelected: { backgroundColor: '#0E9F95' },
  modeText: { color: 'white', fontWeight: '700' },
  captureRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 34 },
  shutter: { width: 68, height: 68, borderRadius: 34, backgroundColor: '#18304055', alignItems: 'center', justifyContent: 'center' },
  shutterInner: { backgroundColor: 'white', width: 54, height: 54, borderRadius: 27 },
  record: { paddingHorizontal: 20, paddingVertical: 14, backgroundColor: '#0E9F95', borderRadius: 24 },
  recording: { backgroundColor: '#EF4444' },
  recordText: { color: 'white', fontWeight: '800' },
  editor: { flex: 1 },
  editorContent: { flexGrow: 1, gap: 12, paddingBottom: 24 },
  editorHeader: { height: 40, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cancel: { color: '#0E9F95', width: 56 },
  heading: { fontSize: 18, fontWeight: '800' },
  stepCount: { width: 42, textAlign: 'right', fontSize: 12, fontWeight: '700' },
  stepTrack: { height: 4, borderRadius: 2, overflow: 'hidden', marginBottom: 4 },
  stepFill: { height: 4, borderRadius: 2 },
  preview: { width: '100%', height: 220, backgroundColor: '#FFFFFF', borderRadius: 14 },
  trim: { gap: 8 },
  trimFields: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  trimInput: { flex: 1, borderRadius: 10, padding: 10 },
  trimDash: {},
  coverButton: { minHeight: 36, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  coverText: { fontWeight: '700' },
  coverThumb: { width: 30, height: 30, borderRadius: 4 },
  soundSelected: { fontWeight: '700' },
  captionInput: { minHeight: 56, maxHeight: 95, borderRadius: 12, padding: 12, textAlignVertical: 'top' },
  counter: { fontSize: 12, textAlign: 'right', marginTop: -8 },
  hashtagRow: { flexDirection: 'row', gap: 8 },
  hashtagInput: { flex: 1, minHeight: 42, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12 },
  hashtagButton: { paddingHorizontal: 14, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  hashtagButtonText: { color: 'white', fontWeight: '800' },
  suggestedTags: { flexDirection: 'row', gap: 8 },
  tagSuggestion: { borderRadius: 16, paddingHorizontal: 11, paddingVertical: 6 },
  tagSuggestionText: { fontSize: 12, fontWeight: '700' },
  label: { fontSize: 14, fontWeight: '600' },
  privacy: { flexDirection: 'row', gap: 8 },
  publicNotice: { padding: 13, borderRadius: 10 },
  publicNoticeText: { fontSize: 13, lineHeight: 19, fontWeight: '600' },
  privacyChoice: { flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: 'center', borderWidth: 1 },
  privacySelected: { borderColor: '#0E9F95', backgroundColor: '#E3F4F2' },
  privacyText: { fontSize: 12, fontWeight: '700' },
  privacyTextSelected: { color: '#183040' },
  commentsRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  publishArea: { marginTop: 'auto', gap: 8 },
  progress: { color: '#627789', textAlign: 'center' },
  progressTrack: { height: 4, backgroundColor: '#DAE5ED', borderRadius: 2, overflow: 'hidden' },
  progressFill: { height: 4, backgroundColor: '#0E9F95' },
});
