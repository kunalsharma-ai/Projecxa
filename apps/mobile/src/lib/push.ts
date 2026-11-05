/**
 * Push notifications through Expo's push service (free; Android delivery uses the Firebase key and
 * iOS the Apple key that are uploaded once to the Expo project, see docs/MOBILE_APP.md).
 *
 * The phone gets an Expo push token and gives it to the PROJEXA server with the categories the
 * person wants. The server sends a push when a fieldwork alert opens, a request gets a reply, a
 * task reminder is due or a won bid arrives. Each push carries the screen to open in `data.path`.
 */
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { Api } from './api';
import { storage } from './storage';

export const PUSH_KEY = 'projexa.pushToken';
/** Set when the person turned push off in Account, so the app does not register again on its own. */
export const PUSH_OFF_KEY = 'projexa.pushOff';

export interface PushCategory { key: string; label: string; hint: string }
export interface PushDevice {
  id: string;
  categories: string[];
  /** Categories this person can get (portal users only get requests). */
  available: PushCategory[];
  /** Push is turned on for this server in Settings → Integrations. */
  enabled: boolean;
}

/** Notifications that arrive while the app is open show as a banner too. */
export function configureForeground() {
  if (Platform.OS === 'web') return;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
  });
}

export type PushTokenResult = { token: string } | { error: string };

/** Asks for permission (once) and returns this phone's Expo push token. */
export async function getPushToken(): Promise<PushTokenResult> {
  if (Platform.OS === 'web') return { error: 'Push notifications work in the phone app only.' };
  if (!Device.isDevice) return { error: 'Push notifications need a real phone, not a simulator.' };
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'PROJEXA',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 200, 120, 200],
      lightColor: '#8B5CF6',
    });
  }
  let { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
  if (status !== 'granted') return { error: 'Notifications are turned off for PROJEXA in your phone settings.' };
  const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) return { error: 'This build has no Expo project ID yet (see “Android test build” in docs/MOBILE_APP.md).' };
  try {
    const t = await Notifications.getExpoPushTokenAsync({ projectId });
    return { token: t.data };
  } catch (e) {
    return { error: `Could not get a push token: ${(e as Error).message}` };
  }
}

export function deviceName() {
  return [Device.manufacturer, Device.modelName].filter(Boolean).join(' ') || Platform.OS;
}

/** Registers (or refreshes) this phone with the server. */
export async function registerDevice(api: Api, token: string, categories?: string[]) {
  const d = await api.post<PushDevice>('/push/devices', { token, platform: Platform.OS === 'ios' ? 'ios' : 'android', name: deviceName(), ...(categories ? { categories } : {}) });
  await storage.set(PUSH_KEY, token);
  return d;
}

/** On sign-out: this phone stops getting pushes for the person. */
export async function unregisterDevice(api: Api) {
  const token = await storage.get(PUSH_KEY);
  if (!token) return;
  try {
    await api.post('/push/devices/remove', { token });
  } catch {
    // The server also drops tokens Expo reports as gone.
  }
  await storage.set(PUSH_KEY, null);
}

/** The app screen for a web path in a push (or an insight link). */
export function appRoute(href: string) {
  const path = href.split('?')[0];
  const m = path.match(/^\/projects\/([^/]+)$/);
  if (m && m[1] !== 'new') return `/project/${m[1]}`;
  const r = path.match(/^\/requests\/([^/]+)$/);
  if (r) return `/request/${r[1]}`;
  const portal = path.match(/^\/portal\/(client|vendor)\/requests\/([^/]+)$/);
  if (portal) return `/portal/${portal[1]}`;
  return path;
}
