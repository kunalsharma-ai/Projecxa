import { RedirectConfig, RedirectModeT, RedirectRule, ParamMapping } from './redirect.types';

export interface RuleChange {
  kind: 'added' | 'removed' | 'changed';
  status: string;
  scope: { countryCode?: string; vendorId?: string };
  /** Fields that differ, for a changed rule. */
  fields: { field: string; before: string | null; after: string | null }[];
  before: RedirectRule | null;
  after: RedirectRule | null;
}
export interface ParamChange {
  kind: 'added' | 'removed' | 'changed';
  canonical: string;
  scope: { countryCode?: string; vendorId?: string };
  before: ParamMapping | null;
  after: ParamMapping | null;
}
export interface ConfigDiff {
  mode: { before: RedirectModeT; after: RedirectModeT } | null;
  rules: RuleChange[];
  params: ParamChange[];
  unchangedRules: number;
}

const scopeKey = (s?: { countryCode?: string; vendorId?: string }) => `${s?.vendorId ?? ''}|${s?.countryCode ?? ''}`;
const show = (v: unknown) => (v === undefined || v === null || v === '' ? null : typeof v === 'boolean' ? (v ? 'yes' : 'no') : String(v));
const RULE_FIELDS = ['type', 'url', 'fallbackUrl', 'timeoutMs', 'enabled', 'callbackRequired'] as const;

/** What changed between two redirect versions, rule by rule (a rule is identified by status and scope). */
export function diffConfigs(a: { mode: RedirectModeT; config: RedirectConfig }, b: { mode: RedirectModeT; config: RedirectConfig }): ConfigDiff {
  const rules: RuleChange[] = [];
  let unchanged = 0;
  const left = new Map(a.config.rules.map((r) => [`${r.status}|${scopeKey(r.scope)}`, r]));
  const right = new Map(b.config.rules.map((r) => [`${r.status}|${scopeKey(r.scope)}`, r]));
  for (const key of new Set([...left.keys(), ...right.keys()])) {
    const x = left.get(key) ?? null;
    const y = right.get(key) ?? null;
    const base = (x ?? y)!;
    const scope = { ...(base.scope?.countryCode ? { countryCode: base.scope.countryCode } : {}), ...(base.scope?.vendorId ? { vendorId: base.scope.vendorId } : {}) };
    if (!x) rules.push({ kind: 'added', status: base.status, scope, fields: [], before: null, after: y });
    else if (!y) rules.push({ kind: 'removed', status: base.status, scope, fields: [], before: x, after: null });
    else {
      const fields = RULE_FIELDS.filter((f) => show(x[f]) !== show(y[f])).map((f) => ({ field: f, before: show(x[f]), after: show(y[f]) }));
      if (fields.length) rules.push({ kind: 'changed', status: base.status, scope, fields, before: x, after: y });
      else unchanged++;
    }
  }
  const order = { added: 0, changed: 1, removed: 2 };
  rules.sort((p, q) => scopeKey(p.scope).localeCompare(scopeKey(q.scope)) || p.status.localeCompare(q.status) || order[p.kind] - order[q.kind]);

  const params: ParamChange[] = [];
  const pl = new Map(a.config.params.map((p) => [`${p.canonical}|${scopeKey(p.scope)}`, p]));
  const pr = new Map(b.config.params.map((p) => [`${p.canonical}|${scopeKey(p.scope)}`, p]));
  for (const key of new Set([...pl.keys(), ...pr.keys()])) {
    const x = pl.get(key) ?? null;
    const y = pr.get(key) ?? null;
    const base = (x ?? y)!;
    const scope = { ...(base.scope?.countryCode ? { countryCode: base.scope.countryCode } : {}), ...(base.scope?.vendorId ? { vendorId: base.scope.vendorId } : {}) };
    if (!x) params.push({ kind: 'added', canonical: base.canonical, scope, before: null, after: y });
    else if (!y) params.push({ kind: 'removed', canonical: base.canonical, scope, before: x, after: null });
    else if (x.alias !== y.alias || x.required !== y.required) params.push({ kind: 'changed', canonical: base.canonical, scope, before: x, after: y });
  }
  return { mode: a.mode === b.mode ? null : { before: a.mode, after: b.mode }, rules, params, unchangedRules: unchanged };
}
