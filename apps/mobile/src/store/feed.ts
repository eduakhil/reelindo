import { create } from 'zustand';
import { apiRequest, sendFeedFeedback, type FeedPost } from '@/src/services/api';

type FeedFeedbackAction = 'NOT_INTERESTED' | 'SHOW_LESS';
type FeedState = { posts: FeedPost[]; cursor: string | null; loading: boolean; error: string | null; pendingUploadId: string | null; load: (refresh?: boolean) => Promise<void>; watchUpload: (id: string | null) => void; toggleLike: (id: string) => Promise<void>; toggleSave: (id: string) => Promise<void>; feedback: (id: string, action: FeedFeedbackAction) => Promise<void>; share: (id: string) => Promise<string> };
let feedRequestId = 0;
export const useFeedStore = create<FeedState>((set, get) => ({
  posts: [], cursor: null, loading: false, error: null, pendingUploadId: null,
  watchUpload: (pendingUploadId) => set({ pendingUploadId }),
  load: async (refresh = false) => {
    const { loading } = get(); if (loading && !refresh) return;
    const { cursor } = get();
    const requestId = ++feedRequestId;
    set({ loading: true, error: null });
    try {
      const query = new URLSearchParams({ limit: '8', ...(refresh || !cursor ? {} : { cursor }) });
      const page = await apiRequest<{ items: FeedPost[]; nextCursor: string | null }>(`/v2/feed/foryou?${query.toString()}`);
      if (requestId !== feedRequestId) return;
      set((state) => ({ posts: refresh || !cursor ? page.items : [...state.posts, ...page.items], cursor: page.nextCursor, loading: false }));
    } catch (error) {
      if (requestId !== feedRequestId) return;
      set({ loading: false, error: error instanceof Error ? error.message : 'Could not load the feed' });
    }
  },
  toggleLike: async (id) => {
    const post = get().posts.find((item) => item.id === id); if (!post) return;
    const liked = !post.viewerHasLiked;
    set((state) => ({ posts: state.posts.map((item) => item.id === id ? { ...item, viewerHasLiked: liked, likesCount: Math.max(0, item.likesCount + (liked ? 1 : -1)) } : item) }));
    try { await apiRequest(`/posts/${id}/like`, { method: liked ? 'POST' : 'DELETE' }); }
    catch (error) { set((state) => ({ posts: state.posts.map((item) => item.id === id ? { ...item, viewerHasLiked: !liked, likesCount: Math.max(0, item.likesCount + (liked ? -1 : 1)) } : item), error: error instanceof Error ? error.message : 'Like failed' })); throw error; }
  },
  toggleSave: async (id) => {
    const post = get().posts.find((item) => item.id === id); if (!post) return;
    const saved = !post.viewerHasSaved;
    set((state) => ({ posts: state.posts.map((item) => item.id === id ? { ...item, viewerHasSaved: saved } : item) }));
    try { await apiRequest(`/posts/${id}/save`, { method: saved ? 'POST' : 'DELETE' }); }
    catch (error) { set((state) => ({ posts: state.posts.map((item) => item.id === id ? { ...item, viewerHasSaved: !saved } : item) })); throw error; }
  },
  feedback: async (id, action) => {
    const original = get().posts;
    const target = original.find((item) => item.id === id);
    if (!target) return;
    set({ posts: original.filter((item) => action === 'SHOW_LESS' ? item.userId !== target.userId : item.id !== id) });
    try { await sendFeedFeedback(id, action); }
    catch (error) { set({ posts: original, error: error instanceof Error ? error.message : 'Could not update your recommendations' }); throw error; }
  },
  share: async (id) => { const result = await apiRequest<{ shareUrl: string }>(`/posts/${id}/share`, { method: 'POST' }); return result.shareUrl; },
}));
