import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

/** Keychain / Keystore on phones; the browser's storage when the app runs on the web for previews. */
const web = Platform.OS === 'web';

export const storage = {
  async get(key: string): Promise<string | null> {
    try {
      return web ? globalThis.localStorage?.getItem(key) ?? null : await SecureStore.getItemAsync(key);
    } catch {
      return null;
    }
  },
  async set(key: string, value: string | null) {
    try {
      if (web) {
        if (value === null) globalThis.localStorage?.removeItem(key);
        else globalThis.localStorage?.setItem(key, value);
      } else if (value === null) await SecureStore.deleteItemAsync(key);
      else await SecureStore.setItemAsync(key, value);
    } catch {
      // Storage is a convenience; signing in again always works.
    }
  },
};

export const KEYS = { server: 'projexa.server', webUrl: 'projexa.webUrl', token: 'projexa.token', theme: 'projexa.theme' } as const;
