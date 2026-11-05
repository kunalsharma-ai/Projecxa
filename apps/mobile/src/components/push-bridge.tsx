import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { featureForRoute } from '@/lib/features';
import { appRoute, configureForeground, getPushToken, PUSH_OFF_KEY, registerDevice } from '@/lib/push';
import { useSession } from '@/lib/session';
import { storage } from '@/lib/storage';

configureForeground();

/**
 * While someone is signed in: registers this phone for push (asks permission the first time), and
 * opens the right screen when a notification is tapped, also when the tap started the app.
 */
export function PushBridge() {
  const { me, api, access } = useSession();
  const accessRef = useRef(access);
  accessRef.current = access;
  const userId = me?.user.id;

  useEffect(() => {
    if (!userId || Platform.OS === 'web') return;
    let live = true;
    (async () => {
      if ((await storage.get(PUSH_OFF_KEY)) === userId) return;
      const t = await getPushToken();
      if (live && 'token' in t) await registerDevice(api, t.token).catch(() => undefined);
    })();
    return () => {
      live = false;
    };
  }, [userId, api]);

  useEffect(() => {
    if (!userId || Platform.OS === 'web') return;
    const open = (data: unknown) => {
      const path = (data as { path?: unknown } | null)?.path;
      if (typeof path !== 'string' || !path.startsWith('/')) return;
      const r = appRoute(path);
      const f = featureForRoute(r);
      if (!f || accessRef.current.allowed.has(f.key)) router.push(r as never);
    };
    const last = Notifications.getLastNotificationResponse();
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (last) {
      Notifications.clearLastNotificationResponse();
      // Let the first screen mount before opening the one the push points to.
      timer = setTimeout(() => open(last.notification.request.content.data), 400);
    }
    const sub = Notifications.addNotificationResponseReceivedListener((r) => open(r.notification.request.content.data));
    return () => {
      sub.remove();
      if (timer) clearTimeout(timer);
    };
  }, [userId]);

  return null;
}
