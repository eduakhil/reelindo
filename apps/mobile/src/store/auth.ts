import { create } from 'zustand';
import { apiRequest, clearTokens, getRefreshToken, restoreAccessToken, setTokens } from '@/src/services/api';

type User = { id: string; username: string; role: string; avatarUrl?: string | null; language?: 'en' | 'hi'; isPrivate: boolean };
type Session = { user: User; accessToken: string; refreshToken: string };
type AuthState = {
  user: User | null;
  authenticated: boolean;
  ready: boolean;
  initialize: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (input: { email: string; username: string; displayName: string; password: string; birthDate: string }) => Promise<void>;
  setLanguage: (language: 'en' | 'hi') => void;
  setPrivacy: (isPrivate: boolean) => void;
  logout: () => Promise<void>;
};

export const useAuthStore = create<AuthState>((set) => ({
  user: null, authenticated: false, ready: false,
  initialize: async () => {
    try {
      const valid = await restoreAccessToken();
      if (!valid) { set({ user: null, authenticated: false, ready: true }); return; }
      const user = await apiRequest<User>('/users/me');
      set({ user, authenticated: true, ready: true });
    } catch (error) {
      console.warn('Could not restore the saved session.', error);
      try { await clearTokens(); } catch (clearError) { console.warn('Could not clear the expired saved session.', clearError); }
      set({ user: null, authenticated: false, ready: true });
    }
  },
  login: async (email, password) => {
    const session = await apiRequest<Session>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    await setTokens(session.accessToken, session.refreshToken); set({ user: session.user, authenticated: true, ready: true });
  },
  register: async (input) => {
    const session = await apiRequest<Session>('/auth/register', { method: 'POST', body: JSON.stringify(input) });
    await setTokens(session.accessToken, session.refreshToken); set({ user: session.user, authenticated: true, ready: true });
  },
  logout: async () => {
    const refreshToken = await getRefreshToken();
    if (refreshToken) await apiRequest('/auth/logout', { method: 'POST', body: JSON.stringify({ refreshToken }) }).catch(() => undefined);
    await clearTokens(); set({ user: null, authenticated: false, ready: true });
  },
  setLanguage: (language) => set((state) => state.user ? { user: { ...state.user, language } } : state),
  setPrivacy: (isPrivate) => set((state) => state.user ? { user: { ...state.user, isPrivate } } : state),
}));
