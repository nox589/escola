import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { create } from 'zustand';

/** JWT + refresh token live in SecureStore only (SPEC §13). Web dev fallback: sessionStorage. */
const KEY = 'escola.auth';

const storage = {
  async get() {
    if (Platform.OS === 'web') return globalThis.sessionStorage?.getItem(KEY) ?? null;
    return SecureStore.getItemAsync(KEY);
  },
  async set(v: string | null) {
    if (Platform.OS === 'web') {
      if (v) globalThis.sessionStorage?.setItem(KEY, v);
      else globalThis.sessionStorage?.removeItem(KEY);
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
