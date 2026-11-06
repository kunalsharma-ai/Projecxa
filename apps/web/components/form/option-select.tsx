'use client';
import { useEffect, useMemo, useState } from 'react';
import { get, post } from '@/lib/api';
import { Combobox, type Option } from './combobox';

/** Dropdowns people can add their own options to ("Add +"); kept per organisation in the database. */
export type CustomField = 'category' | 'targetGroup' | 'language' | 'uidParam' | 'defaultVendor';
interface Row { id: string; field: string; value: string }

const cache = new Map<string, Promise<Row[]>>();
/** The organisation's own options for one dropdown (loaded once per page view). */
export function loadCustomOptions(field: CustomField, fresh = false): Promise<Row[]> {
  if (fresh || !cache.has(field)) cache.set(field, get<Row[]>(`/custom-options?field=${field}`).catch(() => []));
  return cache.get(field)!;
}

/** Saves an option someone typed, so everyone gets it next time. Failures are quiet: the value still applies. */
export async function saveCustomOption(field: CustomField, value: string) {
  const v = value.trim();
  if (!v) return;
  const known = await loadCustomOptions(field);
  if (known.some((o) => o.value.toLowerCase() === v.toLowerCase())) return;
  await post('/custom-options', { field, value: v }).catch(() => undefined);
  cache.delete(field);
}

export function useCustomOptions(field: CustomField) {
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => {
    let live = true;
    loadCustomOptions(field).then((r) => live && setRows(r));
    return () => { live = false; };
  }, [field]);
  return rows.map((r) => r.value);
}

/**
 * Searchable dropdown with the built-in choices plus the organisation's own. Typing something new
 * offers “Add …”, which saves it as an option for everyone.
 */
export function AddableSelect({ field, base, value, onChange, placeholder, disabled }: { field: CustomField; base: string[]; value: string; onChange: (v: string) => void; placeholder?: string; disabled?: boolean }) {
  const own = useCustomOptions(field);
  const [added, setAdded] = useState<string[]>([]);
  const options: Option[] = useMemo(() => {
    const seen = new Set<string>();
    const out: Option[] = [];
    for (const [list, group] of [[base, 'Standard'], [[...own, ...added], 'Added by your team']] as const)
      for (const v of list) {
        if (seen.has(v.toLowerCase())) continue;
        seen.add(v.toLowerCase());
        out.push({ value: v, label: v, group: own.length || added.length ? group : undefined });
      }
    if (value && !seen.has(value.toLowerCase())) out.push({ value, label: value });
    return out;
  }, [base, own, added, value]);
  return (
    <Combobox
      options={options}
      value={value || null}
      creatable
      disabled={disabled}
      placeholder={placeholder ?? 'Choose or type to add…'}
      onChange={(v) => {
        const next = v ?? '';
        if (next && !options.some((o) => o.value.toLowerCase() === next.toLowerCase())) {
          setAdded((a) => [...a, next]);
          saveCustomOption(field, next);
        }
        onChange(next);
      }}
    />
  );
}
