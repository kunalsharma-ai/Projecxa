'use client';
import clsx from 'clsx';
import { InfoTip } from '@/components/help';

export type DeviceSettings = { desktop: boolean; mobile: boolean; tablet: boolean; android: boolean; ios: boolean };

/** Fills in Android / iOS for projects saved before they existed (both allowed). */
export function withOs(d: Partial<Record<string, boolean>> | null | undefined): DeviceSettings {
  return { desktop: d?.desktop !== false, mobile: d?.mobile !== false, tablet: d?.tablet !== false, android: d?.android !== false, ios: d?.ios !== false };
}

/** Message to show when the device choice cannot be saved, or null. */
export function devicesProblem(d: DeviceSettings): string | null {
  if (!d.desktop && !d.mobile && !d.tablet) return 'Allow at least one device.';
  if (d.mobile && !d.android && !d.ios) return 'Choose Android, iOS or both for mobile.';
  return null;
}

/** Android / iOS checkboxes shown under Mobile. Phones with any other system get in only when both are ticked. */
export function MobileOsPicker({ devices, onChange, disabled }: { devices: DeviceSettings; onChange: (d: DeviceSettings) => void; disabled?: boolean }) {
  const off = disabled || !devices.mobile;
  return (
    <div className={clsx('flex flex-wrap items-center gap-4 pl-6 text-sm', off && 'opacity-50')} role="group" aria-label="Phone systems allowed">
      {(['android', 'ios'] as const).map((k) => (
        <label key={k} className="flex items-center gap-2">
          <input type="checkbox" className="h-4 w-4" disabled={off} checked={devices[k]} onChange={(e) => onChange({ ...devices, [k]: e.target.checked })} />
          {k === 'android' ? 'Android' : 'iOS (iPhone)'}
        </label>
      ))}
      <InfoTip id="device.mobileOs" />
      {devices.mobile && !devices.android && !devices.ios && <span className="text-xs text-warn">Pick at least one</span>}
    </div>
  );
}
