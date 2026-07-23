'use client';

import { resilienceScore, weeklyBuckets, type OuraMetricKey, type OuraStatsDay } from '@/lib/health/ouraStats';

function valueFor(day: OuraStatsDay, metric: OuraMetricKey): number | null {
  const value = day[metric];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function fmt(value: number | null, suffix = ''): string {
  if (value === null) return '—';
  const rounded = Math.abs(value) >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded}${suffix}`;
}

function latestValue(days: OuraStatsDay[], metric: OuraMetricKey): number | null {
  for (let index = days.length - 1; index >= 0; index -= 1) {
    const value = valueFor(days[index], metric);
    if (value !== null) return value;
  }
  return null;
}

function comparison(days: OuraStatsDay[], metric: OuraMetricKey, period: number): number | null {
  const current = days.slice(-period).map(day => valueFor(day, metric)).filter((value): value is number => value !== null);
  const previous = days.slice(Math.max(0, days.length - period * 2), Math.max(0, days.length - period))
    .map(day => valueFor(day, metric))
    .filter((value): value is number => value !== null);
  return mean(previous) === null || mean(current) === null ? null : mean(previous);
}

export function LongMetricTile({
  title,
  metric,
  days,
  period,
  suffix = '',
}: {
  title: string;
  metric: OuraMetricKey;
  days: OuraStatsDay[];
  period: number;
  suffix?: string;
}) {
  const latest = latestValue(days, metric);
  const prior = comparison(days, metric, period);
  if (latest === null) return null;
  const buckets = weeklyBuckets(days.slice(-period), metric).slice(-13);
  const finiteAverages = buckets.map(bucket => bucket.average).filter((value): value is number => value !== null);
  const domainMin = finiteAverages.length ? Math.min(...finiteAverages) : 0;
  const domainMax = finiteAverages.length ? Math.max(...finiteAverages) : 1;
  const span = domainMax - domainMin || 1;

  return (
    <div className="rounded-xl border border-[rgba(255,255,255,0.07)] bg-[#0e1013] p-3">
      <div className="text-[10px] font-bold uppercase tracking-widest text-[#9b978f]">{title}</div>
      <div className="mt-2 text-2xl font-extrabold text-[#e8e6e1]">{fmt(latest, suffix)}</div>
      {prior !== null && <div className="mt-1 text-xs text-[#9b978f]">was {fmt(prior, suffix)} in the prior {period}d</div>}
      {finiteAverages.length > 1 && (
        <div className="mt-1 text-[10px] text-[#9b978f]">weekly range {fmt(domainMin, suffix)}–{fmt(domainMax, suffix)}</div>
      )}
      <div className="mt-3 flex h-9 items-end gap-1">
        {buckets.map(bucket => (
          <div
            key={bucket.startDate}
            className="flex-1 rounded-sm bg-[#d9a53f]"
            style={{
              height: bucket.average === null ? '4px' : `${8 + ((bucket.average - domainMin) / span) * 28}px`,
              opacity: bucket.average === null ? 0.15 : 0.8,
            }}
            title={`${bucket.startDate}: ${fmt(bucket.average, suffix)}`}
          />
        ))}
      </div>
    </div>
  );
}

export function ResilienceTile({ days, period }: { days: OuraStatsDay[]; period: number }) {
  const scored = days.map(day => ({
    ...day,
    resilienceNumeric: resilienceScore(day.resilienceLevel),
  }));
  const latest = [...days].reverse().find(day => day.resilienceLevel)?.resilienceLevel ?? null;
  if (!latest) return null;
  const buckets = weeklyBuckets(
    scored.map(day => ({ localDate: day.localDate, activityScore: day.resilienceNumeric })),
    'activityScore',
  ).slice(-Math.ceil(period / 7));

  return (
    <div className="rounded-xl border border-[rgba(255,255,255,0.07)] bg-[#0e1013] p-3">
      <div className="text-[10px] font-bold uppercase tracking-widest text-[#9b978f]">Resilience</div>
      <div className="mt-2 text-2xl font-extrabold capitalize text-[#e8e6e1]">{latest}</div>
      <div className="mt-1 text-xs text-[#9b978f]">weekly average strip</div>
      <div className="mt-3 flex h-9 items-end gap-1">
        {buckets.map(bucket => (
          <div
            key={bucket.startDate}
            className="flex-1 rounded-sm bg-[#8fae74]"
            style={{ height: `${Math.max(12, ((bucket.average ?? 0) / 5) * 36)}px`, opacity: 0.75 }}
            title={`${bucket.startDate}: ${fmt(bucket.average)}`}
          />
        ))}
      </div>
    </div>
  );
}
