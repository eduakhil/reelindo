import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type GestureResponderEvent } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { Image } from 'expo-image';
import { VideoView, useVideoPlayer } from 'expo-video';
import { router, useFocusEffect } from 'expo-router';
import Svg, { Polyline, Text as SvgText } from 'react-native-svg';
import { Screen } from '@/src/components/Screen';
import { Button } from '@/src/components/Button';
import { AppIcon } from '@/src/components/AppIcon';
import { getCloseFriends, getTrending, searchContent, uploadStory, type StoryItem, type StoryOverlay, type StorySound, type StoryAudience, type UploadGrant } from '@/src/services/api';
import { useAppTheme } from '@/src/theme/useAppTheme';

const textStyles: StoryItem['textStyle'][] = ['BOLD', 'SERIF', 'TYPEWRITER', 'NEON'];
const filters: StoryItem['filter'][] = ['NONE', 'WARM', 'COOL', 'DREAM'];
const storyStickers = ['✨', '❤️', '🔥', '😂', '🌈', '🙌'];
type StoryAsset = Pick<ImagePicker.ImagePickerAsset, 'uri'> & Partial<Pick<ImagePicker.ImagePickerAsset, 'fileName' | 'mimeType' | 'type' | 'width' | 'height' | 'duration' | 'fileSize'>>;

export default function CreateStoryScreen() {
  const { colors } = useAppTheme();
  const [asset, setAsset] = useState<StoryAsset | null>(null);
  const cameraRef = useRef<CameraView>(null);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [microphonePermission, requestMicrophonePermission] = useMicrophonePermissions();
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraMode, setCameraMode] = useState<'picture' | 'video'>('picture');
  const [cameraFacing, setCameraFacing] = useState<'back' | 'front'>('back');
  const [recording, setRecording] = useState(false);
  const [caption, setCaption] = useState('');
  const [textStyle, setTextStyle] = useState<StoryItem['textStyle']>('BOLD');
  const [filter, setFilter] = useState<StoryItem['filter']>('NONE');
  const [sounds, setSounds] = useState<StorySound[]>([]);
  const [soundId, setSoundId] = useState<string | null>(null);
  const [soundSearch, setSoundSearch] = useState('');
  const [soundError, setSoundError] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [uploadGrant, setUploadGrant] = useState<UploadGrant | null>(null);
  const [overlays, setOverlays] = useState<StoryOverlay[]>([]);
  const [activeStroke, setActiveStroke] = useState<Extract<StoryOverlay, { type: 'DRAW' }> | null>(null);
  const [pendingSticker, setPendingSticker] = useState<string | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [drawColor, setDrawColor] = useState('#FFFFFF');
  const [previewSize, setPreviewSize] = useState({ width: 1, height: 1 });
  const strokeRef = useRef<Extract<StoryOverlay, { type: 'DRAW' }> | null>(null);
  const [closeFriendCount, setCloseFriendCount] = useState(0);
  const [closeFriendError, setCloseFriendError] = useState('');

  const selectedSound = sounds.find((sound) => sound.id === soundId) ?? null;
  const previewPlayer = useVideoPlayer(asset?.type === 'video' ? asset.uri : null, (video) => { video.loop = true; video.muted = true; });
  const musicPlayer = useVideoPlayer(selectedSound?.audioUrl ?? null, (audio) => { audio.loop = true; audio.muted = false; audio.play(); });
  useEffect(() => {
    if (selectedSound) musicPlayer.play();
    else musicPlayer.pause();
  }, [musicPlayer, selectedSound]);
  useEffect(() => {
    previewPlayer.muted = Boolean(selectedSound);
  }, [previewPlayer, selectedSound]);

  useEffect(() => {
    let active = true;
    void getTrending().then((data) => { if (active) setSounds(data.sounds); }).catch((error: unknown) => {
      if (active) setSoundError(error instanceof Error ? error.message : 'Could not load sounds.');
    });
    return () => { active = false; };
  }, []);

  useFocusEffect(useCallback(() => {
    let active = true;
    void getCloseFriends().then(({ items }) => {
      if (active) {
        setCloseFriendCount(items.length);
        setCloseFriendError('');
      }
    }).catch((cause: unknown) => {
      if (active) setCloseFriendError(cause instanceof Error ? cause.message : 'Could not load Close Friends.');
    });
    return () => { active = false; };
  }, []));

  useEffect(() => {
    let active = true;
    const query = soundSearch.trim();
    if (!query) return;
    const timer = setTimeout(() => {
      void searchContent(query, 'sounds').then((result) => {
        if (!active) return;
        setSounds((current) => [...result.sounds, ...current.filter((sound) => !result.sounds.some((match) => match.id === sound.id))]);
        setSoundError('');
      }).catch((error: unknown) => {
        if (active) setSoundError(error instanceof Error ? error.message : 'Could not search sounds.');
      });
    }, 300);
    return () => { active = false; clearTimeout(timer); };
  }, [soundSearch]);

  const choose = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Photo access needed', 'Allow photo library access to select story media.');
      return;
    }
    const pickerOptions: ImagePicker.ImagePickerOptions = {
      mediaTypes: ['images', 'videos'],
      allowsEditing: false,
      quality: 0.9,
      videoMaxDuration: 60,
      preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
    };
    const result = await ImagePicker.launchImageLibraryAsync(pickerOptions);
    if (result.canceled || !result.assets[0]) return;
    const selected = result.assets[0];
    const video = selected.type === 'video';
    const type = selected.mimeType ?? (video ? 'video/mp4' : 'image/jpeg');
    const allowed = video ? ['video/mp4', 'video/quicktime'] : ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(type)) {
      Alert.alert('Unsupported media', 'Choose an MP4 or MOV video, or a JPEG, PNG, or WebP photo.');
      return;
    }
    const maximum = video ? 100 * 1024 * 1024 : 25 * 1024 * 1024;
    if (selected.fileSize && selected.fileSize > maximum) {
      Alert.alert('File is too large', video ? 'Story videos must be 100 MB or smaller.' : 'Story photos must be 25 MB or smaller.');
      return;
    }
    setAsset(selected);
    setOverlays([]);
    setPendingSticker(null);
    setUploadGrant(null);
    setProgress(0);
  };

  const openCamera = async () => {
    if (!cameraPermission?.granted) {
      const permission = await requestCameraPermission();
      if (!permission.granted) {
        Alert.alert('Camera access needed', 'Allow camera access to take a story photo or record a video.');
        return;
      }
    }
    setCameraMode('picture');
    setCameraFacing('back');
    setCameraOpen(true);
  };

  const takePhoto = async () => {
    try {
      const result = await cameraRef.current?.takePictureAsync({ quality: 0.9 });
      if (!result?.uri) return;
      setAsset({
        uri: result.uri,
        fileName: `story-${Date.now()}.jpg`,
        mimeType: 'image/jpeg',
        type: 'image',
        width: result.width,
        height: result.height,
      });
      setOverlays([]);
      setPendingSticker(null);
      setUploadGrant(null);
      setCameraOpen(false);
      setProgress(0);
    } catch (error) {
      Alert.alert('Photo capture failed', error instanceof Error ? error.message : 'Please try again.');
    }
  };

  const recordVideo = async () => {
    if (recording) {
      cameraRef.current?.stopRecording();
      return;
    }
    if (!microphonePermission?.granted) {
      const permission = await requestMicrophonePermission();
      if (!permission.granted) {
        Alert.alert('Microphone access needed', 'Allow microphone access to record a story video with sound.');
        return;
      }
    }
    setRecording(true);
    try {
      const result = await cameraRef.current?.recordAsync({ maxDuration: 60 });
      if (!result?.uri) return;
      setAsset({
        uri: result.uri,
        fileName: `story-${Date.now()}.mp4`,
        mimeType: 'video/mp4',
        type: 'video',
      });
      setOverlays([]);
      setPendingSticker(null);
      setUploadGrant(null);
      setCameraOpen(false);
      setProgress(0);
    } catch (error) {
      Alert.alert('Video recording failed', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setRecording(false);
    }
  };

  const pointForEvent = (event: GestureResponderEvent) => ({
    x: Math.max(0, Math.min(1, event.nativeEvent.locationX / previewSize.width)),
    y: Math.max(0, Math.min(1, event.nativeEvent.locationY / previewSize.height)),
  });

  const placeOrStartDrawing = (event: GestureResponderEvent) => {
    if (pendingSticker) {
      const point = pointForEvent(event);
      setOverlays((current) => current.length < 20 ? [...current, { type: 'STICKER', value: pendingSticker, ...point, scale: 1 }] : current);
      setPendingSticker(null);
      return;
    }
    if (!drawing || overlays.length >= 20) return;
    const stroke: Extract<StoryOverlay, { type: 'DRAW' }> = { type: 'DRAW', points: [pointForEvent(event)], color: drawColor, width: 0.012 };
    strokeRef.current = stroke;
    setActiveStroke(stroke);
  };

  const continueDrawing = (event: GestureResponderEvent) => {
    const stroke = strokeRef.current;
    if (!drawing || !stroke || stroke.points.length >= 250) return;
    const updated = { ...stroke, points: [...stroke.points, pointForEvent(event)] };
    strokeRef.current = updated;
    setActiveStroke(updated);
  };

  const finishDrawing = () => {
    const stroke = strokeRef.current;
    if (stroke && stroke.points.length > 1) setOverlays((current) => current.length < 20 ? [...current, stroke] : current);
    strokeRef.current = null;
    setActiveStroke(null);
  };

  const publish = async (shareAudience: StoryAudience) => {
    if (!asset || busy) return;
    if (shareAudience === 'CLOSE_FRIENDS' && !closeFriendCount) {
      Alert.alert('Close Friends list is empty', 'Add people to your Close Friends list before sharing.');
      return;
    }
    setBusy(true);
    try {
      const video = asset.type === 'video';
      await uploadStory(
        asset.uri,
        asset.fileName ?? `story-${Date.now()}.${video ? 'mp4' : 'jpg'}`,
        asset.mimeType ?? (video ? 'video/mp4' : 'image/jpeg'),
        video ? 'VIDEO' : 'PHOTO',
        { audience: shareAudience, caption: caption.trim(), textStyle, filter, soundId, overlays },
        setProgress,
        uploadGrant ?? undefined,
        setUploadGrant,
      );
      Alert.alert('Story shared', `Your story is available to ${shareAudience === 'CLOSE_FRIENDS' ? 'your Close Friends' : 'your followers'} for 24 hours.`);
      router.back();
    } catch (error) {
      Alert.alert('Upload failed', error instanceof Error ? error.message : 'Please check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  const tint = useMemo(() => ({
    NONE: 'transparent',
    WARM: '#FF9B4A26',
    COOL: '#4F9BFF30',
    DREAM: '#D995FF26',
  })[filter], [filter]);
  const textFace = {
    BOLD: { fontFamily: undefined, fontWeight: '900' as const, color: 'white', textShadowColor: '#000A', textShadowRadius: 6 },
    SERIF: { fontFamily: 'serif', fontWeight: '700' as const, color: 'white', textShadowColor: '#000A', textShadowRadius: 6 },
    TYPEWRITER: { fontFamily: 'monospace', fontWeight: '700' as const, color: 'white', textShadowColor: '#000A', textShadowRadius: 6 },
    NEON: { fontFamily: undefined, fontWeight: '900' as const, color: '#FFFFFF', textShadowColor: '#42F5D7', textShadowRadius: 14 },
  }[textStyle];

  if (cameraOpen) return <View style={styles.cameraPage}>
    <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing={cameraFacing} mode={cameraMode}>
      <View style={styles.cameraControls}>
        <View style={styles.cameraTop}>
          <Pressable accessibilityRole="button" onPress={() => { if (recording) cameraRef.current?.stopRecording(); else setCameraOpen(false); }}><Text style={styles.cameraAction}>{recording ? 'Stop & use' : 'Cancel'}</Text></Pressable>
          <Pressable accessibilityRole="button" onPress={() => setCameraFacing((value) => value === 'back' ? 'front' : 'back')}><Text style={styles.cameraAction}>Flip</Text></Pressable>
        </View>
        <View style={styles.cameraBottom}>
          <View style={styles.cameraModes}>
            <Pressable accessibilityRole="button" disabled={recording} accessibilityState={{ selected: cameraMode === 'picture', disabled: recording }} onPress={() => setCameraMode('picture')}><Text style={[styles.cameraMode, cameraMode === 'picture' && styles.cameraModeSelected]}>PHOTO</Text></Pressable>
            <Pressable accessibilityRole="button" disabled={recording} accessibilityState={{ selected: cameraMode === 'video', disabled: recording }} onPress={() => setCameraMode('video')}><Text style={[styles.cameraMode, cameraMode === 'video' && styles.cameraModeSelected]}>VIDEO</Text></Pressable>
          </View>
          {cameraMode === 'picture'
            ? <Pressable accessibilityRole="button" accessibilityLabel="Take story photo" onPress={() => void takePhoto()} style={styles.shutter}><View style={styles.shutterInner} /></Pressable>
            : <Pressable accessibilityRole="button" accessibilityLabel={recording ? 'Stop recording story' : 'Record story video'} onPress={() => void recordVideo()} style={[styles.recordButton, recording && styles.recordButtonActive]}><Text style={styles.recordLabel}>{recording ? 'Stop' : 'Record'}</Text></Pressable>}
        </View>
      </View>
    </CameraView>
  </View>;

  return <Screen style={[styles.page, { backgroundColor: colors.background }]}>
    <View style={[styles.header, { borderBottomColor: colors.border }]}>
      <Pressable accessibilityRole="button" onPress={() => router.back()}><Text style={[styles.cancel, { color: colors.accent }]}>Cancel</Text></Pressable>
      <Text style={[styles.title, { color: colors.text }]}>Create story</Text>
      <Text style={[styles.step, { color: colors.muted }]}>{asset ? 'Edit story' : 'Add media'}</Text>
    </View>
    {asset ? <View
      style={styles.preview}
      onLayout={({ nativeEvent }) => setPreviewSize({ width: nativeEvent.layout.width, height: nativeEvent.layout.height })}
      onTouchStart={placeOrStartDrawing}
      onTouchMove={continueDrawing}
      onTouchEnd={finishDrawing}
      onTouchCancel={finishDrawing}
    >
      {asset.type === 'video' ? <VideoView player={previewPlayer} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls /> : <Image source={{ uri: asset.uri }} style={StyleSheet.absoluteFill} contentFit="cover" />}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: tint }]} />
      {caption.trim() ? <Text pointerEvents="none" style={[styles.captionPreview, textFace]}>{caption.trim()}</Text> : null}
      <Svg pointerEvents="none" width="100%" height="100%" viewBox="0 0 1000 1000" preserveAspectRatio="none" style={styles.overlayLayer}>
        {[...overlays, ...(activeStroke ? [activeStroke] : [])].map((overlay, index) => overlay.type === 'DRAW'
          ? <Polyline key={`draw-${index}`} points={overlay.points.map((point) => `${point.x * 1000},${point.y * 1000}`).join(' ')} fill="none" stroke={overlay.color} strokeWidth={overlay.width * 1000} strokeLinecap="round" strokeLinejoin="round" />
          : <SvgText key={`sticker-${index}`} x={overlay.x * 1000} y={overlay.y * 1000} fill="white" stroke="#0009" strokeWidth={2} fontSize={54 * overlay.scale} textAnchor="middle" alignmentBaseline="middle">{overlay.value}</SvgText>)}
      </Svg>
      {selectedSound ? <View style={styles.soundBadge}><Text numberOfLines={1} style={styles.soundBadgeText}>♫ {selectedSound.title}{selectedSound.artist ? ` · ${selectedSound.artist}` : ''}</Text></View> : null}
      {pendingSticker ? <Text pointerEvents="none" style={styles.previewHint}>Tap to place {pendingSticker}</Text> : drawing ? <Text pointerEvents="none" style={styles.previewHint}>Draw on your story</Text> : null}
    </View> : <View style={[styles.empty, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={[styles.emptyIcon, { backgroundColor: colors.surfaceRaised }]}><AppIcon name="create" color={colors.accent} size={30} /></View>
      <Text style={[styles.emptyTitle, { color: colors.text }]}>Start with a moment</Text>
      <Text style={[styles.hint, { color: colors.muted }]}>Choose a photo or a video up to 60 seconds.</Text>
      <View style={styles.mediaButtons}>
        <Button onPress={() => void choose()}>Choose from gallery</Button>
        <Button variant="secondary" onPress={() => void openCamera()}>Open camera</Button>
      </View>
    </View>}
    {asset ? <ScrollView style={styles.editor} contentContainerStyle={styles.editorContent} keyboardShouldPersistTaps="handled">
      <Text style={[styles.section, { color: colors.text }]}>Add words</Text>
      <TextInput
        accessibilityLabel="Story text"
        value={caption}
        onChangeText={setCaption}
        maxLength={200}
        placeholder="Write something on your story…"
        placeholderTextColor={colors.muted}
        multiline
        style={[styles.captionInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface }]}
      />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {textStyles.map((style) => <Pressable key={style} accessibilityRole="button" accessibilityState={{ selected: textStyle === style }} onPress={() => setTextStyle(style)} style={[styles.chip, { backgroundColor: textStyle === style ? colors.accent : colors.surfaceRaised }]}><Text style={[styles.chipText, { color: textStyle === style ? 'white' : colors.text }]}>{style === 'TYPEWRITER' ? 'Typewriter' : style[0] + style.slice(1).toLowerCase()}</Text></Pressable>)}
      </ScrollView>
      <Text style={[styles.section, { color: colors.text }]}>Emoji stickers</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {storyStickers.map((sticker) => <Pressable key={sticker} accessibilityRole="button" accessibilityLabel={`Place ${sticker} sticker`} onPress={() => { setDrawing(false); setPendingSticker(sticker); }} style={[styles.chip, { backgroundColor: pendingSticker === sticker ? colors.accent : colors.surfaceRaised }]}><Text style={styles.sticker}>{sticker}</Text></Pressable>)}
      </ScrollView>
      <Text style={[styles.hint, { color: colors.muted }]}>Choose a sticker, then tap its position on the preview.</Text>
      <Text style={[styles.section, { color: colors.text }]}>Draw</Text>
      <View style={styles.drawTools}>
        {['#FFFFFF', '#55C9BC', '#3978D4', '#F87171'].map((color) => <Pressable key={color} accessibilityRole="button" accessibilityLabel={`Choose drawing color ${color}`} accessibilityState={{ selected: drawColor === color }} onPress={() => setDrawColor(color)} style={[styles.drawColor, { backgroundColor: color, borderColor: drawColor === color ? colors.text : colors.border }]} />)}
        <Pressable accessibilityRole="button" accessibilityState={{ selected: drawing }} onPress={() => { setPendingSticker(null); setDrawing((value) => !value); }} style={[styles.drawToggle, { backgroundColor: drawing ? colors.accent : colors.surfaceRaised }]}><Text style={[styles.chipText, { color: drawing ? 'white' : colors.text }]}>{drawing ? 'Done drawing' : 'Draw on preview'}</Text></Pressable>
        <Pressable accessibilityRole="button" onPress={() => setOverlays((current) => current.filter((overlay) => overlay.type !== 'DRAW'))} style={[styles.drawToggle, { backgroundColor: colors.surfaceRaised }]}><Text style={[styles.chipText, { color: colors.text }]}>Clear drawings</Text></Pressable>
      </View>
      <Text style={[styles.section, { color: colors.text }]}>Choose a filter</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {filters.map((value) => <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: filter === value }} onPress={() => setFilter(value)} style={[styles.chip, { backgroundColor: filter === value ? colors.accent : colors.surfaceRaised }]}><Text style={[styles.chipText, { color: filter === value ? 'white' : colors.text }]}>{value[0] + value.slice(1).toLowerCase()}</Text></Pressable>)}
      </ScrollView>
      <Text style={[styles.section, { color: colors.text }]}>Add music</Text>
      <TextInput accessibilityLabel="Search sounds" value={soundSearch} onChangeText={setSoundSearch} placeholder="Search songs and sounds" placeholderTextColor={colors.muted} autoCapitalize="none" style={[styles.searchInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface }]} />
      <Pressable accessibilityRole="button" accessibilityState={{ selected: soundId === null }} onPress={() => setSoundId(null)} style={[styles.soundRow, { borderColor: colors.border }]}>
        <Text style={[styles.soundTitle, { color: colors.text }]}>No music</Text><Text style={[styles.soundArtist, { color: colors.muted }]}>{soundId === null ? 'Selected' : 'Remove selected sound'}</Text>
      </Pressable>
      {soundError ? <Text style={[styles.error, { color: colors.danger }]}>{soundError}</Text> : null}
      {sounds.slice(0, 12).map((sound) => <Pressable key={sound.id} accessibilityRole="button" accessibilityState={{ selected: soundId === sound.id }} onPress={() => setSoundId(sound.id)} style={[styles.soundRow, { borderColor: colors.border, backgroundColor: soundId === sound.id ? colors.surfaceRaised : 'transparent' }]}>
        <View style={[styles.musicIcon, { backgroundColor: colors.surfaceRaised }]}><Text style={{ color: colors.accent, fontSize: 18 }}>♫</Text></View>
        <View style={styles.soundInfo}><Text numberOfLines={1} style={[styles.soundTitle, { color: colors.text }]}>{sound.title}</Text><Text numberOfLines={1} style={[styles.soundArtist, { color: colors.muted }]}>{sound.artist ?? 'Original sound'}</Text></View>
        <Text style={[styles.selectLabel, { color: colors.accent }]}>{soundId === sound.id ? 'Selected' : 'Use'}</Text>
      </Pressable>)}
      <Text style={[styles.section, { color: colors.text }]}>Share with</Text>
      <Text style={[styles.hint, { color: colors.muted }]}>Close Friends list: {closeFriendCount}</Text>
      {closeFriendError ? <Text style={[styles.error, { color: colors.danger }]}>{closeFriendError}</Text> : null}
      {!closeFriendCount ? <Pressable accessibilityRole="button" onPress={() => router.push('/settings/close-friends')} style={styles.manageFriends}><Text style={[styles.selectLabel, { color: colors.accent }]}>Manage Close Friends</Text></Pressable> : null}
      {busy ? <View style={styles.uploadState}><ActivityIndicator color={colors.accent} /><Text style={[styles.hint, { color: colors.muted }]}>Uploading story… {progress}%</Text><View style={[styles.progressTrack, { backgroundColor: colors.surfaceRaised }]}><View style={[styles.progressFill, { width: `${progress}%`, backgroundColor: colors.accent }]} /></View></View> : null}
      <View style={styles.actions}>
        <Button variant="secondary" onPress={() => void choose()} disabled={busy}>Change media</Button>
        <Button variant="secondary" onPress={() => void openCamera()} disabled={busy}>Take another photo or video</Button>
        <Button variant="secondary" onPress={() => void publish('CLOSE_FRIENDS')} disabled={busy || closeFriendCount === 0}>{busy ? `Uploading ${progress}%` : 'Close Friends'}</Button>
        <Button onPress={() => void publish('FOLLOWERS')} disabled={busy}>{busy ? `Uploading ${progress}%` : uploadGrant ? 'Retry story upload' : 'Your Story'}</Button>
      </View>
      <Text style={[styles.note, { color: colors.muted }]}>Stories are shared with your followers and expire after 24 hours.</Text>
    </ScrollView> : null}
  </Screen>;
}

const styles = StyleSheet.create({
  cameraPage: { flex: 1, backgroundColor: '#000000' },
  cameraControls: { flex: 1, justifyContent: 'space-between', padding: 22, paddingTop: 56 },
  cameraTop: { flexDirection: 'row', justifyContent: 'space-between' },
  cameraAction: { color: 'white', fontSize: 16, fontWeight: '800', padding: 10 },
  cameraBottom: { alignItems: 'center', gap: 22, paddingBottom: 20 },
  cameraModes: { flexDirection: 'row', gap: 26 },
  cameraMode: { color: '#FFFFFFB0', fontWeight: '800', letterSpacing: 1, padding: 8 },
  cameraModeSelected: { color: 'white' },
  shutter: { width: 74, height: 74, borderRadius: 37, borderWidth: 5, borderColor: 'white', alignItems: 'center', justifyContent: 'center' },
  shutterInner: { width: 56, height: 56, borderRadius: 28, backgroundColor: 'white' },
  recordButton: { width: 80, height: 80, borderRadius: 40, backgroundColor: '#E5484D', alignItems: 'center', justifyContent: 'center', borderWidth: 5, borderColor: 'white' },
  recordButtonActive: { backgroundColor: '#A3272D' },
  recordLabel: { color: 'white', fontWeight: '900', fontSize: 12 },
  page: { flex: 1, paddingHorizontal: 18 },
  header: { height: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth },
  cancel: { width: 60, fontWeight: '700' },
  title: { fontSize: 18, fontWeight: '800' },
  step: { width: 75, textAlign: 'right', fontSize: 12, fontWeight: '700' },
  preview: { height: 280, backgroundColor: '#000000', borderRadius: 16, overflow: 'hidden', marginTop: 14, justifyContent: 'center', alignItems: 'center' },
  captionPreview: { position: 'absolute', left: 20, right: 20, top: '44%', textAlign: 'center', fontSize: 30, lineHeight: 38 },
  overlayLayer: { ...StyleSheet.absoluteFill },
  previewHint: { position: 'absolute', top: 10, alignSelf: 'center', backgroundColor: '#07121BCC', color: 'white', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 7, fontSize: 12, fontWeight: '700' },
  soundBadge: { position: 'absolute', left: 12, right: 12, bottom: 12, backgroundColor: '#07121BCC', borderRadius: 18, paddingHorizontal: 13, paddingVertical: 8 },
  soundBadgeText: { color: 'white', fontSize: 12, fontWeight: '700' },
  empty: { flex: 1, minHeight: 360, borderRadius: 18, borderWidth: 1, alignItems: 'center', justifyContent: 'center', padding: 24, marginTop: 14 },
  emptyIcon: { width: 68, height: 68, borderRadius: 22, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  emptyTitle: { fontSize: 18, fontWeight: '800', textAlign: 'center' },
  hint: { fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 8 },
  mediaButtons: { width: '100%', gap: 10, marginTop: 20 },
  editor: { flex: 1, marginTop: 8 },
  editorContent: { gap: 10, paddingBottom: 24 },
  section: { fontSize: 15, fontWeight: '800', marginTop: 7 },
  captionInput: { minHeight: 68, borderWidth: 1, borderRadius: 12, padding: 12, textAlignVertical: 'top' },
  searchInput: { height: 44, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12 },
  chips: { gap: 8, paddingVertical: 2 },
  chip: { borderRadius: 18, paddingHorizontal: 14, paddingVertical: 9 },
  chipText: { fontWeight: '700', fontSize: 12 },
  sticker: { fontSize: 21 },
  drawTools: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 9 },
  drawColor: { width: 28, height: 28, borderRadius: 14, borderWidth: 2 },
  drawToggle: { minHeight: 34, justifyContent: 'center', borderRadius: 18, paddingHorizontal: 12, paddingVertical: 8 },
  manageFriends: { minHeight: 38, justifyContent: 'center', paddingHorizontal: 8 },
  soundRow: { minHeight: 56, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, gap: 10 },
  musicIcon: { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  soundInfo: { flex: 1 },
  soundTitle: { fontSize: 13, fontWeight: '800' },
  soundArtist: { fontSize: 11, marginTop: 3 },
  selectLabel: { fontSize: 12, fontWeight: '800' },
  error: { fontSize: 12 },
  actions: { gap: 9, marginTop: 8 },
  uploadState: { alignItems: 'center', gap: 8 },
  progressTrack: { height: 4, borderRadius: 2, overflow: 'hidden', width: '100%' },
  progressFill: { height: 4 },
  note: { textAlign: 'center', fontSize: 12, lineHeight: 18, paddingVertical: 8 },
});
