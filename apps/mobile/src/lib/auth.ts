import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { create } from 'zustand';

/**
 * JWT + refresh token live in SecureStore on iOS/Android (SPEC §13). On the web (beta PWA) they live in
 * localStorage so parents stay signed in across app restarts; the refresh token rotates on use.
 */
const KEY = 'escola.auth';

const storage = {
  async get() {
    if (Platform.OS === 'web') {
      try {
        // One-time move from the old per-tab storage.
        const old = globalThis.sessionStorage?.getItem(KEY);
        if (old && !globalThis.localStorage?.getItem(KEY)) globalThis.localStorage?.setItem(KEY, old);
        return globalThis.localStorage?.getItem(KEY) ?? null;
      } catch {
        return null;
      }
    }
    return SecureStore.getItemAsync(KEY);
  },
  async set(v: string | null) {
    if (Platform.OS === 'web') {
      try {
        if (v) globalThis.localStorage?.setItem(KEY, v);
        else globalThis.localStorage?.removeItem(KEY);
        globalThis.sessionStorage?.removeItem(KEY);
      } catch {
        /* private mode: stays signed in for this session only */
      }
      return;
    }
    if (v) await SecureStore.setItemAsync(KEY, v);
    else await SecureStore.deleteItemAsync(KEY);
  },
};

export interface Tokens {
  accessToken: string;
  refreshToken: string;
}

interface AuthState {
  ready: boolean;
  tokens: Tokens | null;
  load(): Promise<void>;
  setTokens(t: Tokens | null): Promise<void>;
}

export const useAuth = create<AuthState>((set) => ({
  ready: false,
  tokens: null,
  async load() {
    const raw = await storage.get().catch(() => null);
    set({ ready: true, tokens: raw ? (JSON.parse(raw) as Tokens) : null });
  },
  async setTokens(t) {
    await storage.set(t ? JSON.stringify(t) : null);
    set({ tokens: t });
  },
}));
