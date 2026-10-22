import * as SecureStore from 'expo-secure-store';
import { File, UploadType } from 'expo-file-system';
import { Platform } from 'react-native';

const baseUrl = process.env.EXPO_PUBLIC_API_URL ?? (Platform.OS === 'android' ? 'http://10.0.2.2:4000' : 'http://localhost:4000');
export const getApiBaseUrl = () => baseUrl;
function apiConnectionError(): Error {
  let host = 'the configured server';
  try {
    const url = new URL(baseUrl);
    host = url.port ? `${url.hostname}:${url.port}` : url.hostname;
  } catch {
    host = 'the configured API URL';
  }
  const deviceHint = Platform.OS === 'android'
    ? 'On a physical Android phone, set EXPO_PUBLIC_API_URL to your computer Wi-Fi IPv4 address (not localhost or 10.0.2.2).'
    : 'On a physical phone, use your computer Wi-Fi IPv4 address instead of localhost.';
  return new Error(`Cannot reach the Reelindo API at ${host}. Make sure the API is running, the phone and computer are on the same Wi-Fi, and Windows Firewall allows TCP port 4000. ${deviceHint}`);
}
const storageOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK };
let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;

export class ApiRequestError extends Error {
  constructor(message: string, readonly code?: string, readonly postId?: string) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

export async function setTokens(access: string, refresh: string) {
  accessToken = access;
  await SecureStore.setItemAsync('refresh_token', refresh, storageOptions);
}

export async function clearTokens() {
  accessToken = null;
  await SecureStore.deleteItemAsync('refresh_token');
}

async function refreshAccessToken(): Promise<boolean> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const refreshToken = await SecureStore.getItemAsync('refresh_token');
    if (!refreshToken) return false;
    try {
      const response = await fetch(`${baseUrl}/auth/refresh`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshToken }) });
      if (!response.ok) return false;
      const result = (await response.json()) as { accessToken: string; refreshToken: string };
      await setTokens(result.accessToken, result.refreshToken);
      return true;
    } catch { return false; }
  })().finally(() => { refreshing = null; });
  return refreshing;
}

export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const makeRequest = () => fetch(`${baseUrl}${path}`, { ...options, headers: { 'content-type': 'application/json', ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}), ...options.headers } });
  let response: Response;
  try {
    response = await makeRequest();
  } catch {
    throw apiConnectionError();
  }
  if (response.status === 401 && !path.startsWith('/auth/')) {
    if (await refreshAccessToken()) response = await makeRequest();
  }
  if (!response.ok) {
    const error = (await response.json().catch(() => ({ message: 'Request failed' }))) as { message?: string; code?: string; postId?: string };
    throw new ApiRequestError(error.message ?? 'Request failed', error.code, error.postId);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export async function restoreAccessToken() {
  if (Platform.OS === 'web') return false;
  return refreshAccessToken();
}

export async function getSocketAccessToken() {
  if (!accessToken) await refreshAccessToken();
  return accessToken;
}
export async function refreshSocketAccessToken() {
  await refreshAccessToken();
  return accessToken;
}

export async function getRefreshToken() {
  return SecureStore.getItemAsync('refresh_token');
}

export async function logoutAllDevices() {
  return apiRequest<void>('/auth/logout-all', { method: 'POST' });
}

export type FeedPost = { id: string; userId: string; type: 'REEL' | 'PHOTO'; caption: string | null; videoUrl: string | null; thumbnailUrl: string | null; previewUrl: string | null; duration: number | null; createdAt: string; likesCount: number; commentsCount: number; sharesCount: number; user: { id: string; username: string; displayName: string; avatarUrl: string | null }; sound: { id: string; title: string; artist: string | null; audioUrl: string } | null; viewerHasLiked: boolean; viewerHasSaved: boolean; recommendationVariant?: 'v1' | 'v2'; recommendationReasons?: string[]; recommendationScore?: number };
export type FeedPage = { items: FeedPost[]; nextCursor: string | null };
export const sendFeedFeedback = (postId: string, action: 'NOT_INTERESTED' | 'SHOW_LESS') => apiRequest<{ postId: string; action: string }>(`/v2/feed/${postId}/feedback`, { method: 'POST', body: JSON.stringify({ action }) });
export const sendPostView = (postId: string, watchMs: number, completedPct: number) => apiRequest<{ accepted: boolean }>(`/posts/${postId}/view`, { method: 'POST', body: JSON.stringify({ watchMs, completedPct }) });
export type FeedInterestTopic = { id: string; name: string; selected: boolean };
export const getFeedInterests = () => apiRequest<{ items: FeedInterestTopic[] }>('/v2/feed/interests');
export const saveFeedInterests = (topicIds: string[]) => apiRequest<{ topicIds: string[] }>('/v2/feed/interests', { method: 'PUT', body: JSON.stringify({ topicIds }) });

export type UploadGrant = { uploadUrl: string; key: string; assetUrl: string; expiresIn: number; requiredHeaders: Record<string, string> };
export type MediaUploadSession = { media: UploadGrant; cover?: UploadGrant };
export type CreatedPost = { id: string; status: 'PROCESSING' | 'READY' | 'FAILED'; createdAt: string };
export type SocialUser = { id: string; username: string; displayName: string; bio: string | null; avatarUrl: string | null; website: string | null; isVerified: boolean; isPrivate: boolean; language: 'en' | 'hi'; followersCount: number; followingCount: number; postsCount: number; likesCount: number; isSelf: boolean; followStatus: 'SELF' | 'NONE' | 'ACCEPTED' | 'PENDING'; isBlocked: boolean; canViewPosts: boolean };
export type SocialPost = { id: string; type: 'REEL' | 'PHOTO'; status?: 'PROCESSING' | 'READY' | 'FAILED'; caption: string | null; thumbnailUrl: string | null; videoUrl: string | null; previewUrl?: string | null; visibility?: 'PUBLIC' | 'FOLLOWERS' | 'PRIVATE'; allowComments?: boolean; createdAt: string; likesCount: number; commentsCount: number; user?: Pick<SocialUser, 'id' | 'username' | 'displayName' | 'avatarUrl'> };
export type PostDetail = SocialPost & { userId: string; viewsCount: number; savesCount: number; sound: StorySound | null; viewerHasLiked?: boolean; viewerHasSaved?: boolean; media?: Array<{ url: string; order: number }>; user: Pick<SocialUser, 'id' | 'username' | 'displayName' | 'avatarUrl'> };
export type SocialComment = { id: string; postId: string; userId: string; parentId: string | null; text: string; likesCount: number; viewerHasLiked?: boolean; isPinned?: boolean; createdAt: string; user: Pick<SocialUser, 'id' | 'username' | 'displayName' | 'avatarUrl'>; replies?: SocialComment[] };
export type StorySound = { id: string; title: string; artist: string | null; audioUrl: string; coverUrl: string | null };
export type StoryAudience = 'FOLLOWERS' | 'CLOSE_FRIENDS';
export type StoryOverlay =
  | { type: 'STICKER'; value: string; x: number; y: number; scale: number }
  | { type: 'DRAW'; points: Array<{ x: number; y: number }>; color: string; width: number };
export type StoryItem = {
  id: string;
  mediaUrl: string;
  mediaType: 'VIDEO' | 'PHOTO';
  audience: StoryAudience;
  caption: string | null;
  textStyle: 'BOLD' | 'SERIF' | 'TYPEWRITER' | 'NEON';
  filter: 'NONE' | 'WARM' | 'COOL' | 'DREAM';
  overlays: StoryOverlay[];
  sound: StorySound | null;
  createdAt: string;
  expiresAt: string;
  viewerHasViewed: boolean;
};
export type StoryGroup = { userId: string; user: Pick<SocialUser, 'id' | 'username' | 'displayName' | 'avatarUrl'>; stories: StoryItem[]; hasUnviewed: boolean };
export type CloseFriend = Pick<SocialUser, 'id' | 'username' | 'displayName' | 'avatarUrl'> & { createdAt: string };
export type InboxNotification = { id: string; type: string; isRead: boolean; createdAt: string; actor: Pick<SocialUser, 'id' | 'username' | 'displayName' | 'avatarUrl'> | null; post: { id: string; thumbnailUrl: string | null; caption: string | null } | null; comment: { id: string; text: string } | null };
export type ChatMessage = { id: string; conversationId: string; senderId: string; text: string | null; sharedPostId: string | null; readAt: string | null; createdAt: string; sender: Pick<SocialUser, 'id' | 'username' | 'displayName' | 'avatarUrl'>; sharedPost: { id: string; thumbnailUrl: string | null; caption: string | null } | null };
export type ChatConversation = { id: string; updatedAt: string; peer: Pick<SocialUser, 'id' | 'username' | 'displayName' | 'avatarUrl'> | null; lastMessage: ChatMessage | null };

export const getProfile = (username: string) => apiRequest<SocialUser>(`/users/${encodeURIComponent(username)}`);
export const updateProfile = (input: { displayName?: string; bio?: string; website?: string | null; avatarUrl?: string | null; isPrivate?: boolean; language?: 'en' | 'hi' }) => apiRequest<SocialUser>('/users/me', { method: 'PATCH', body: JSON.stringify(input) });
export const submitReport = (input: { targetType: 'USER' | 'POST' | 'COMMENT' | 'STORY'; targetId: string; reason: string; details?: string }) => apiRequest<{ id: string; status: string; createdAt: string }>('/reports', { method: 'POST', body: JSON.stringify(input) });
export const getBlockedUsers = () => apiRequest<{ items: Array<{ id: string; username: string; displayName: string; avatarUrl: string | null; blockedAt: string }> }>('/users/me/blocks');
export const blockUser = (id: string) => apiRequest<{ blocked: boolean }>(`/users/${id}/block`, { method: 'POST' });
export const unblockUser = (id: string) => apiRequest<{ blocked: boolean }>(`/users/${id}/block`, { method: 'DELETE' });
export const deleteAccount = (password: string) => apiRequest<void>('/users/me/account', { method: 'DELETE', body: JSON.stringify({ password, confirmation: 'DELETE' }) });
export const exportAccountData = () => apiRequest<unknown>('/users/me/export');
export const getCreatorAnalytics = (days: 7 | 28) => apiRequest<{ days: number; totals: { views: number; likes: number; comments: number; newFollowers: number; watchMs: number; averageCompletionPct: number }; byDay: Array<{ date: string; views: number; likes: number; comments: number; followers: number; watchMs: number }> }>(`/analytics/creator?days=${days}`);
export const followUser = (id: string) => apiRequest<{ following: boolean; status: string }>(`/users/${id}/follow`, { method: 'POST' });
export const unfollowUser = (id: string) => apiRequest<{ following: false }>(`/users/${id}/follow`, { method: 'DELETE' });
export const getProfilePosts = (username: string) => apiRequest<{ items: SocialPost[]; nextCursor: string | null }>(`/users/${encodeURIComponent(username)}/posts`);
export const getMyPosts = () => apiRequest<{ items: SocialPost[]; nextCursor: string | null }>('/users/me/posts');
export const getSavedPosts = () => apiRequest<{ items: SocialPost[]; nextCursor: string | null }>('/users/me/saved');
export const getPost = (id: string) => apiRequest<PostDetail>(`/posts/${id}`);
export const deletePost = (id: string) => apiRequest<{ deleted: boolean; mediaCleanup: 'complete' | 'failed' | 'not_configured' }>(`/posts/${id}`, { method: 'DELETE' });
export const retryPost = (id: string) => apiRequest<{ id: string; status: 'PROCESSING' | 'READY' | 'FAILED' }>(`/posts/${id}/retry`, { method: 'POST' });
export const updatePost = (id: string, input: { caption?: string | null; visibility?: 'PUBLIC' | 'FOLLOWERS' | 'PRIVATE'; allowComments?: boolean }) => apiRequest<SocialPost>(`/posts/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
export const getComments = (postId: string) => apiRequest<{ items: SocialComment[]; nextCursor: string | null; commentsEnabled: boolean }>(`/posts/${postId}/comments`);
export const createComment = (postId: string, text: string, parentId?: string) => apiRequest<SocialComment>(`/posts/${postId}/comments`, { method: 'POST', body: JSON.stringify({ text, ...(parentId ? { parentId } : {}) }) });
export const toggleCommentLike = (id: string, liked: boolean) => apiRequest<{ liked: boolean }>(`/comments/${id}/like`, { method: liked ? 'DELETE' : 'POST' });
export const deleteComment = (id: string) => apiRequest<void>(`/comments/${id}`, { method: 'DELETE' });
export const pinComment = (id: string) => apiRequest<{ pinned: boolean }>(`/comments/${id}/pin`, { method: 'POST' });
export const unpinComment = (id: string) => apiRequest<{ pinned: boolean }>(`/comments/${id}/pin`, { method: 'DELETE' });
export const searchContent = (q: string, type = 'top') => apiRequest<{ accounts: SocialUser[]; hashtags: Array<{ id: string; name: string; postsCount: number }>; sounds: Array<StorySound & { usesCount: number }>; posts: SocialPost[] }>(`/explore/search?q=${encodeURIComponent(q)}&type=${type}`);
export const getTrending = () => apiRequest<{ hashtags: Array<{ id: string; name: string; postsCount: number }>; sounds: Array<StorySound & { usesCount: number }> }>('/explore/trending');
export const getStoryFeed = () => apiRequest<StoryGroup[]>('/stories/feed');
export const getCloseFriends = () => apiRequest<{ items: CloseFriend[] }>('/users/me/close-friends');
export const addCloseFriend = (userId: string) => apiRequest<{ added: boolean }>('/users/me/close-friends', { method: 'POST', body: JSON.stringify({ userId }) });
export const removeCloseFriend = (userId: string) => apiRequest<{ removed: boolean }>(`/users/me/close-friends/${encodeURIComponent(userId)}`, { method: 'DELETE' });
export const viewStory = (id: string) => apiRequest<{ viewed: boolean }>(`/stories/${id}/view`, { method: 'POST' });
export const deleteStory = (id: string) => apiRequest<void>(`/stories/${id}`, { method: 'DELETE' });
export const getStoryViewers = (id: string) => apiRequest<{ items: Array<Pick<SocialUser, 'id' | 'username' | 'displayName' | 'avatarUrl'> & { viewedAt: string }> }>(`/stories/${id}/viewers`);
export const getNotifications = () => apiRequest<{ items: InboxNotification[]; nextCursor: string | null; unreadCount: number }>('/notifications');
export const markNotificationsRead = (input: { ids?: string[]; all?: boolean }) => apiRequest<{ updated: number }>('/notifications/read', { method: 'POST', body: JSON.stringify(input) });
export const getConversations = () => apiRequest<{ items: ChatConversation[]; nextCursor: string | null }>('/chat/conversations');
export const startConversation = (userId: string) => apiRequest<{ id: string }>('/chat/conversations', { method: 'POST', body: JSON.stringify({ userId }) });
export const getMessages = (id: string) => apiRequest<{ items: ChatMessage[]; nextCursor: string | null }>(`/chat/conversations/${id}/messages`);
export const sendMessage = (id: string, text: string) => apiRequest<ChatMessage>(`/chat/conversations/${id}/messages`, { method: 'POST', body: JSON.stringify({ text }) });
export const registerDeviceToken = (token: string, platform: 'ios' | 'android' | 'web') => apiRequest<void>('/notifications/device', { method: 'POST', body: JSON.stringify({ token, platform }) });
export const getNotificationPreferences = () => apiRequest<{ pushEnabled: boolean }>('/notifications/preferences');
export const setNotificationPreferences = (pushEnabled: boolean) => apiRequest<{ pushEnabled: boolean }>('/notifications/preferences', { method: 'PUT', body: JSON.stringify({ pushEnabled }) });

async function uploadToStorage(uri: string, url: string, headers: Record<string, string>, onProgress?: (percent: number) => void) {
  const file = new File(uri);
  if (file.size <= 0) throw new Error('The selected media file is empty or unavailable.');
  const response = await file.upload(url, {
    httpMethod: 'PUT',
    uploadType: UploadType.BINARY_CONTENT,
    headers,
    sessionType: 'foreground',
    onProgress: ({ bytesSent, totalBytes }) => {
      if (totalBytes > 0) onProgress?.(Math.min(100, Math.round((bytesSent / totalBytes) * 100)));
    },
  });
  if (response.status < 200 || response.status >= 300) {
    const detail = response.body.trim();
    throw new Error(detail
      ? `Storage rejected the upload (${response.status}): ${detail.slice(0, 240)}`
      : `Storage rejected the upload (${response.status}). Check the storage server and retry.`);
  }
}

export async function uploadStory(
  uri: string,
  fileName: string,
  contentType: string,
  mediaType: 'VIDEO' | 'PHOTO',
  options: { audience: StoryAudience; caption: string; textStyle: StoryItem['textStyle']; filter: StoryItem['filter']; soundId: string | null; overlays: StoryOverlay[] },
  onProgress?: (percent: number) => void,
  existingGrant?: UploadGrant,
  onGrant?: (grant: UploadGrant) => void,
) {
  const file = new File(uri);
  const maximum = mediaType === 'PHOTO' ? 25 * 1024 * 1024 : 100 * 1024 * 1024;
  if (file.size <= 0) throw new Error('The selected story file is empty or unavailable.');
  if (file.size > maximum) throw new Error(mediaType === 'PHOTO' ? 'Story photos must be 25 MB or smaller.' : 'Story videos must be 100 MB or smaller.');
  const grant = existingGrant ?? await apiRequest<UploadGrant>('/stories/upload-url', { method: 'POST', body: JSON.stringify({ fileName, contentType, fileSize: file.size }) });
  onGrant?.(grant);
  await uploadToStorage(uri, grant.uploadUrl, grant.requiredHeaders, onProgress);
  return apiRequest<StoryItem>('/stories', { method: 'POST', body: JSON.stringify({ mediaKey: grant.key, mediaType, ...options }) });
}
export async function uploadMedia(uri: string, fileName: string, contentType: string, type: 'REEL' | 'PHOTO', caption: string, visibility: 'PUBLIC' | 'FOLLOWERS' | 'PRIVATE', allowComments: boolean, duration?: number, width?: number, height?: number, onProgress?: (percent: number) => void, trimStart?: number, trimEnd?: number, coverUri?: string, soundId?: string, existingSession?: MediaUploadSession, onSession?: (session: MediaUploadSession) => void) {
  const file = new File(uri);
  const maxSize = type === 'PHOTO' ? 25 * 1024 * 1024 : 300 * 1024 * 1024;
  if (file.size <= 0) throw new Error('The selected media file is empty or unavailable.');
  if (file.size > maxSize) throw new Error(type === 'PHOTO' ? 'Photos must be 25 MB or smaller.' : 'Videos must be 300 MB or smaller.');
  const grant = existingSession?.media ?? await apiRequest<UploadGrant>('/posts/upload-url', { method: 'POST', body: JSON.stringify({ fileName, contentType, fileSize: file.size }) });
  onSession?.({ media: grant });
  await uploadToStorage(uri, grant.uploadUrl, grant.requiredHeaders, onProgress);
  let coverKey: string | undefined;
  if (coverUri && type === 'REEL') {
    const cover = new File(coverUri);
    if (cover.size <= 0 || cover.size > 25 * 1024 * 1024) throw new Error('The cover image must be non-empty and no larger than 25 MB.');
    const coverGrant = existingSession?.cover ?? await apiRequest<UploadGrant>('/posts/upload-url', { method: 'POST', body: JSON.stringify({ fileName: `cover-${Date.now()}.jpg`, contentType: 'image/jpeg', fileSize: cover.size }) });
    onSession?.({ media: grant, cover: coverGrant });
    await uploadToStorage(coverUri, coverGrant.uploadUrl, coverGrant.requiredHeaders);
    coverKey = coverGrant.key;
  }
  return apiRequest<CreatedPost>('/posts', { method: 'POST', body: JSON.stringify({ type, caption, mediaKey: grant.key, mediaUrl: grant.assetUrl, coverKey, duration, width, height, visibility, allowComments, trimStart, trimEnd, soundId }) });
}
