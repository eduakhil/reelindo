import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';

export type CreateDraft = { uri: string; fileName: string; mimeType: string; type: 'REEL' | 'PHOTO'; caption: string; visibility: 'PUBLIC' | 'FOLLOWERS' | 'PRIVATE'; allowComments: boolean; duration?: number; width?: number; height?: number; trimStart?: number; trimEnd?: number; coverUri?: string; soundId?: string; soundTitle?: string };
type DraftState = { draft: CreateDraft | null; restored: boolean; saveDraft: (draft: CreateDraft) => Promise<void>; clearDraft: () => Promise<void>; restore: () => Promise<void> };
const draftKey = 'create_draft_v1';
export const useCreateDraftStore = create<DraftState>((set) => ({
  draft: null, restored: false,
  saveDraft: async (draft) => { await SecureStore.setItemAsync(draftKey, JSON.stringify(draft)); set({ draft }); },
  clearDraft: async () => { await SecureStore.deleteItemAsync(draftKey); set({ draft: null }); },
  restore: async () => {
    const raw = await SecureStore.getItemAsync(draftKey);
    try { set({ draft: raw ? JSON.parse(raw) as CreateDraft : null, restored: true }); }
    catch { await SecureStore.deleteItemAsync(draftKey); set({ draft: null, restored: true }); }
  },
}));
