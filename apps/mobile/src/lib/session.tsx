import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { ApiError, apiRoot, createApi, type Api } from './api';
import { BLOCK_CODES, computeAccess, parseSwitches, type Access, type Block, type FeatureSwitches, type Role } from './features';
import { unregisterDevice } from './push';
import { makePkce, parseReturn, startUrl, type SsoProviderId } from './sso';
import { KEYS, storage } from './storage';

export interface Me {
  user: { id: string; organizationId: string; role: Role; email: string; name: string };
  organization: { id: string; name: string; slug: string };
  branding?: { appName?: string; custom?: boolean; primaryColor?: string | null; hidePoweredBy?: boolean } | null;
  client?: { id: string; name: string } | null;
  vendor?: { id: string; name: string } | null;
  links?: { sampbidxUrl?: string | null; bidzoUrl?: string | null };
}

type LoginResult = { ok: true } | { mfa: true };

interface SessionValue {
  ready: boolean;
  server: string;
  webUrl: string;
  me: Me | null;
  access: Access;
  api: Api;
  /** Re-reads the feature switches now (pull to refresh, after a FEATURE_DISABLED answer). */
  refreshAccess: () => Promise<void>;
  setServer: (server: string, webUrl?: string) => Promise<void>;
  login: (email: string, password: string, organization?: string) => Promise<LoginResult>;
  loginMfa: (code: string) => Promise<void>;
  /** Google, Microsoft or Zoho in the phone's secure browser. Resolves { cancelled } when the person closes it. */
  loginSso: (provider: SsoProviderId, organization?: string) => Promise<LoginResult | { cancelled: true }>;
  logout: () => Promise<void>;
}

const extra = (Constants.expoConfig?.extra ?? {}) as { apiUrl?: string; webUrl?: string };
/** Build-time defaults: EXPO_PUBLIC_API_URL / EXPO_PUBLIC_WEB_URL, or app.json "extra". */
export const DEFAULT_SERVER = process.env.EXPO_PUBLIC_API_URL || extra.apiUrl || '';
export const DEFAULT_WEB = process.env.EXPO_PUBLIC_WEB_URL || extra.webUrl || '';

/** How often the app re-reads the switches while open, in addition to the header check on every call. */
export const FEATURE_POLL_MS = 30_000;

const Ctx = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [server, setServerState] = useState(DEFAULT_SERVER);
  const [webUrl, setWebUrl] = useState(DEFAULT_WEB);
  const [token, setToken] = useState<string | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [switches, setSwitches] = useState<FeatureSwitches | null>(null);
  const [block, setBlock] = useState<Block>(null);
  const mfaToken = useRef<string | null>(null);
  const versionRef = useRef<string | null>(null);
  const refreshing = useRef<Promise<void> | null>(null);
  // The hooks need the latest functions without re-creating the client on every render.
  const hooks = useRef({ refresh: () => Promise.resolve(), signOut: () => Promise.resolve() });

  const api = useMemo(
    () =>
      createApi({
        baseUrl: apiRoot(server),
        token,
        hooks: {
          onFeaturesVersion: (v) => {
            if (versionRef.current !== null && v !== versionRef.current) void hooks.current.refresh();
          },
          onUnauthorized: () => void hooks.current.signOut(),
          onBlocked: (code) => {
            if ((BLOCK_CODES as readonly string[]).includes(code)) setBlock(code as Block);
            void hooks.current.refresh();
          },
        },
      }),
    [server, token],
  );

  const loadSwitches = useCallback(
    async (a: Api = api) => {
      try {
        const s = parseSwitches(await a.get('/auth/me/features'));
        setSwitches(s);
        versionRef.current = s?.version ?? null;
        // The features answer still comes when the account is blocked; all-off then means blocked.
        setBlock((b) => (s && !s.mobile.enabled ? 'MOBILE_DISABLED' : b === 'MOBILE_DISABLED' ? null : b));
      } catch (e) {
        // 404: this server has no Super Admin switches yet, so role rules apply.
        if (e instanceof ApiError && e.status === 404) {
          setSwitches(null);
          versionRef.current = null;
        } else throw e;
      }
    },
    [api],
  );

  const refreshAccess = useCallback(async () => {
    if (!token) return;
    if (refreshing.current) return refreshing.current;
    refreshing.current = (async () => {
      try {
        const m = await api.get<Me>('/auth/me');
        setMe(m);
        await loadSwitches();
      } catch {
        // Keep what we have when offline; the next check tries again.
      } finally {
        refreshing.current = null;
      }
    })();
    return refreshing.current;
  }, [api, token, loadSwitches]);

  const clear = useCallback(async () => {
    setToken(null);
    setMe(null);
    setSwitches(null);
    setBlock(null);
    versionRef.current = null;
    await storage.set(KEYS.token, null);
  }, []);

  hooks.current = { refresh: refreshAccess, signOut: clear };

  // Restore the saved server and session.
  useEffect(() => {
    (async () => {
      const [s, w, t] = await Promise.all([storage.get(KEYS.server), storage.get(KEYS.webUrl), storage.get(KEYS.token)]);
      if (s) setServerState(s);
      if (w) setWebUrl(w);
      if (t && (s || DEFAULT_SERVER)) {
        const a = createApi({ baseUrl: apiRoot(s || DEFAULT_SERVER), token: t });
        try {
          setMe(await a.get<Me>('/auth/me'));
          setToken(t);
        } catch (e) {
          if (e instanceof ApiError && e.status === 401) await storage.set(KEYS.token, null);
          else setToken(t); // offline: keep the session, screens show their own errors
        }
      }
      setReady(true);
    })();
  }, []);

  // Switches: on sign-in, every FEATURE_POLL_MS while open, and whenever the app comes back to the front.
  useEffect(() => {
    if (!token) return;
    void loadSwitches().catch(() => {});
    const timer = setInterval(() => void refreshAccess(), FEATURE_POLL_MS);
    const sub = AppState.addEventListener('change', (st) => st === 'active' && void refreshAccess());
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [token, loadSwitches, refreshAccess]);

  const finish = useCallback(
    async (t: string) => {
      await storage.set(KEYS.token, t);
      const a = createApi({ baseUrl: apiRoot(server), token: t });
      const m = await a.get<Me>('/auth/me');
      setBlock(null);
      setMe(m);
      setToken(t);
    },
    [server],
  );

  const value: SessionValue = {
    ready,
    server,
    webUrl,
    me: token ? me : null,
    access: computeAccess(me?.user.role, switches, block),
    api,
    refreshAccess,
    setServer: async (s, w) => {
      setServerState(s.trim());
      await storage.set(KEYS.server, s.trim() || null);
      if (w !== undefined) {
        setWebUrl(w.trim());
        await storage.set(KEYS.webUrl, w.trim() || null);
      }
    },
    login: async (email, password, organization) => {
      const res = await createApi({ baseUrl: apiRoot(server), token: null }).post<{ token?: string; mfaRequired?: boolean; mfaToken?: string }>('/auth/login', {
        email,
        password,
        ...(organization ? { organization } : {}),
      });
      if (res.mfaRequired && res.mfaToken) {
        mfaToken.current = res.mfaToken;
        return { mfa: true };
      }
      if (!res.token) throw new ApiError('Sign-in did not return a session', 500);
      await finish(res.token);
      return { ok: true };
    },
    loginMfa: async (code) => {
      const c = code.replace(/\s/g, '');
      const body = /^\d{6}$/.test(c) ? { mfaToken: mfaToken.current, code: c } : { mfaToken: mfaToken.current, recoveryCode: code.trim() };
      const res = await createApi({ baseUrl: apiRoot(server), token: null }).post<{ token: string }>('/auth/login/mfa', body);
      mfaToken.current = null;
      await finish(res.token);
    },
    loginSso: async (provider, organization) => {
      const root = apiRoot(server);
      if (!root) throw new ApiError('Set the server address first', 0);
      const pkce = await makePkce(
        (n) => Crypto.getRandomBytes(n),
        (v) => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, v, { encoding: Crypto.CryptoEncoding.BASE64 }),
      );
      // projexa://sso in installed builds; exp://…/--/sso inside Expo Go while developing.
      const redirect = Linking.createURL('sso');
      const result = await WebBrowser.openAuthSessionAsync(startUrl(root, provider, redirect, pkce.challenge, organization), redirect);
      if (result.type !== 'success') return { cancelled: true };
      const back = parseReturn(result.url);
      if ('error' in back) throw new ApiError(back.error, 400);
      if ('cancelled' in back) return { cancelled: true };
      const res = await createApi({ baseUrl: root, token: null }).post<{ token?: string; mfaRequired?: boolean; mfaToken?: string }>('/auth/sso/mobile/exchange', { code: back.code, verifier: pkce.verifier });
      if (res.mfaRequired && res.mfaToken) {
        mfaToken.current = res.mfaToken;
        return { mfa: true };
      }
      if (!res.token) throw new ApiError('Sign-in did not return a session', 500);
      await finish(res.token);
      return { ok: true };
    },
    logout: async () => {
      await unregisterDevice(api);
      try {
        await api.post('/auth/logout');
      } catch {
        // Signing out locally is what matters.
      }
      await clear();
    },
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession outside SessionProvider');
  return v;
}

export const useApi = () => useSession().api;
export const useAccess = () => useSession().access;
export const canEdit = (role?: Role) => role === 'ADMIN' || role === 'PROJECT_MANAGER';
