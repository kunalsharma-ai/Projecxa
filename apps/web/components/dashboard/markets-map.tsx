'use client';
import clsx from 'clsx';
import { geoNaturalEarth1, geoPath, type GeoPermissibleObjects } from 'd3-geo';
import { useEffect, useMemo, useState } from 'react';
import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import { Empty } from '@/components/ui';
import { countryName, flag } from '@/lib/countries';

export interface Market { countryCode: string; clicks: number; completes: number; conversion: number; revenue: number; profit: number; margin: number | null; missing: string[]; liveMarkets: number }
type Metric = 'completes' | 'revenue' | 'conversion';

/** ISO 3166 alpha-2 to the numeric ids used by the world map. */
const NUMERIC: Record<string, string> = {
  US: '840', CA: '124', MX: '484', BR: '076', AR: '032', CL: '152', CO: '170', GB: '826', IE: '372', DE: '276', FR: '250', ES: '724', IT: '380', NL: '528',
  BE: '056', CH: '756', AT: '040', SE: '752', NO: '578', DK: '208', FI: '246', PL: '616', PT: '620', TR: '792', AE: '784', SA: '682', ZA: '710', IN: '356',
  CN: '156', JP: '392', KR: '410', MY: '458', ID: '360', PH: '608', TH: '764', VN: '704', AU: '036', NZ: '554',
};
/** Markets too small for the world outline, drawn as a dot. */
const DOTS: Record<string, [number, number]> = { SG: [103.82, 1.35] };

const W = 800;
const H = 400;
const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
const money = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });

type Shape = { id: string; d: string };
let cache: Promise<Shape[]> | null = null;
/** World outlines, loaded once and only when the map is shown. */
function shapes(): Promise<Shape[]> {
  cache ??= import('world-atlas/countries-110m.json').then((m) => {
    const topo = (m.default ?? m) as unknown as Topology<{ countries: GeometryCollection }>;
    const fc = feature(topo, topo.objects.countries) as unknown as { features: (GeoPermissibleObjects & { id?: string })[] };
    const path = geoPath(projection);
    return fc.features.filter((f) => f.id !== '010').map((f) => ({ id: String(f.id ?? ''), d: path(f) ?? '' }));
  });
  return cache;
}
const projection = geoNaturalEarth1().scale(150).translate([W / 2, H / 2 + 20]);

/** Choropleth of markets: shade by completes, converted revenue or conversion; hover or pick a row for detail. */
export function MarketsMap({ markets, currency }: { markets: Market[]; currency: string }) {
  const [world, setWorld] = useState<Shape[] | null>(null);
  const [metric, setMetric] = useState<Metric>('completes');
  const [focus, setFocus] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    shapes().then((s) => live && setWorld(s)).catch(() => live && setWorld([]));
    return () => {
      live = false;
    };
  }, []);

  const value = (m: Market) => (metric === 'completes' ? m.completes : metric === 'revenue' ? m.revenue : m.conversion);
  const max = Math.max(0, ...markets.map(value));
  const byNumeric = useMemo(() => new Map(markets.filter((m) => NUMERIC[m.countryCode]).map((m) => [NUMERIC[m.countryCode], m])), [markets]);
  const shade = (m: Market | undefined) => (m && max > 0 && value(m) > 0 ? 0.18 + 0.72 * (value(m) / max) : 0);
  const shown = markets.find((m) => m.countryCode === focus) ?? null;
  const fmt = (m: Market) => (metric === 'completes' ? `${m.completes.toLocaleString()} completes` : metric === 'revenue' ? `${currency} ${money.format(m.revenue)}` : `${m.conversion}% conversion`);

  if (markets.length === 0) return <Empty>No market traffic in this period.</Empty>;
  return (
    <div className="@container">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex rounded-lg border border-line p-0.5" role="group" aria-label="Shade by">
          {(['completes', 'revenue', 'conversion'] as const).map((k) => (
            <button key={k} type="button" aria-pressed={metric === k} onClick={() => setMetric(k)} className={clsx('rounded-md px-2.5 py-1 text-xs', metric === k ? 'bg-brand text-brand-ink' : 'text-muted hover:bg-sunken')}>
              {k === 'completes' ? 'Completes' : k === 'revenue' ? `Revenue (${currency})` : 'Conversion'}
            </button>
          ))}
        </div>
        <div className="min-h-[1.25rem] text-xs text-muted" aria-live="polite">
          {shown ? <><span className="font-medium text-ink">{flag(shown.countryCode)} {countryName(shown.countryCode)}</span> · {fmt(shown)} · {shown.clicks.toLocaleString()} clicks{shown.liveMarkets ? ` · ${shown.liveMarkets} live` : ''}</> : 'Hover a country for detail'}
        </div>
      </div>
      <div className="grid gap-4 @2xl:grid-cols-[minmax(0,1fr)_14rem]">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`World map of markets shaded by ${metric}`}>
          {!world ? (
            <rect width={W} height={H} rx={8} className="fill-sunken" />
          ) : (
            world.map((s) => {
              const m = byNumeric.get(s.id);
              const o = shade(m);
              return (
                <path
                  key={s.id + s.d.length}
                  d={s.d}
                  className={clsx('stroke-panel transition-colors', m ? 'cursor-pointer' : '', focus && m?.countryCode === focus ? 'stroke-ink' : '')}
                  strokeWidth={focus && m?.countryCode === focus ? 1.5 : 0.5}
                  style={{ fill: o ? `rgb(var(--brand) / ${o})` : 'rgb(var(--line))' }}
                  onMouseEnter={() => m && setFocus(m.countryCode)}
                  onMouseLeave={() => setFocus(null)}
                >
                  {m && <title>{`${countryName(m.countryCode)}: ${fmt(m)}`}</title>}
                </path>
              );
            })
          )}
          {world &&
            markets
              .filter((m) => DOTS[m.countryCode])
              .map((m) => {
                const [x, y] = projection(DOTS[m.countryCode]) ?? [0, 0];
                return (
                  <circle key={m.countryCode} cx={x} cy={y} r={5} className="stroke-panel" strokeWidth={1} style={{ fill: `rgb(var(--brand) / ${shade(m) || 0.25})` }} onMouseEnter={() => setFocus(m.countryCode)} onMouseLeave={() => setFocus(null)}>
                    <title>{`${countryName(m.countryCode)}: ${fmt(m)}`}</title>
                  </circle>
                );
              })}
        </svg>
        <ol className="max-h-72 divide-y divide-line overflow-auto text-sm @2xl:max-h-[18rem]">
          {[...markets].sort((a, b) => value(b) - value(a)).map((m) => (
            <li key={m.countryCode}>
              <button type="button" onMouseEnter={() => setFocus(m.countryCode)} onMouseLeave={() => setFocus(null)} onFocus={() => setFocus(m.countryCode)} onBlur={() => setFocus(null)} className={clsx('flex w-full items-center justify-between gap-2 px-1 py-1.5 text-left', focus === m.countryCode && 'bg-sunken')}>
                <span className="min-w-0 truncate">{flag(m.countryCode)} {countryName(m.countryCode)}</span>
                <span className="shrink-0 tabular-nums text-muted">{metric === 'completes' ? compact.format(m.completes) : metric === 'revenue' ? money.format(m.revenue) : `${m.conversion}%`}{m.missing.length > 0 && metric === 'revenue' ? <span className="text-warn" title={`No rate for ${m.missing.join(', ')}`}> *</span> : null}</span>
              </button>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
