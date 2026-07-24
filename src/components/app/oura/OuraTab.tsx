'use client';

import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { isLowWearDay, latencyMinutes, type OuraStatsDay } from '@/lib/health/ouraStats';
import { DayCard } from './DayCard';
import { LongMetricTile, ResilienceTile } from './LongMetricTile';
import { NightCard } from './NightCard';
import { PulseDayCard } from './PulseDayCard';
import { TrendChart } from './TrendChart';

type OuraSummary = {
  connected: boolean;
  lastSyncAt: string | null;
  battery: { level: number | null; charging: boolean; at: string | null } | null;
  days: OuraStatsDay[];
  error?: string;
};

function relativeSync(iso: string | null): { label: string; stale: boolean } {
  if (!iso) return { label: 'Not synced yet', stale: true };
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return { label: 'Sync time unavailable', stale: true };
  const hours = Math.max(0, Math.round(ms / 3_600_000));
  if (hours < 1) return { label: 'Synced just now', stale: false };
  return { label: `Synced ${hours}h ago`, stale: hours > 12 };
}

function dateShort(localDate: string): string {
  const date = new Date(`${localDate}T00:00:00.000Z`);
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(date);
}

function metric(days: OuraStatsDay[], key: keyof OuraStatsDay): Array<number | null> {
  return days.map(day => {
    const value = day[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  });
}

function hasAny(values: Array<number | null>): boolean {
  return values.some(value => value !== null);
}

function StateCard({ title, body, action }: { title: string; body: string; action?: string }) {
  return (
    <div className="rounded-2xl border border-[rgba(var(--overlay-rgb),0.08)] bg-[var(--surface)] p-5">
      <div className="text-base font-bold text-[var(--text)]">{title}</div>
      <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">{body}</p>
      {action && (
        <a href="/app/settings" className="mt-4 inline-flex rounded-xl bg-[var(--blue)] px-4 py-2 text-sm font-bold text-[var(--blue-on)]">
          {action}
        </a>
      )}
    </div>
  );
}

export function OuraTab() {
  const [summary, setSummary] = useState<OuraSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [period, setPeriod] = useState<7 | 30 | 90>(30);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/health/oura/summary?days=90');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Oura summary unavailable.');
      setSummary(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Oura summary unavailable.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const visibleDays = useMemo(() => (summary?.days ?? []).slice(-period), [summary?.days, period]);
  const labels = useMemo(() => visibleDays.map(day => dateShort(day.localDate)), [visibleDays]);
  const lowWearMask = useMemo(() => visibleDays.map(isLowWearDay), [visibleDays]);
  const freshness = relativeSync(summary?.lastSyncAt ?? null);
  const sleepScoreValues = metric(visibleDays, 'sleepScore');
  const deepSleepValues = metric(visibleDays, 'deepSleepMinutes');
  const hrvValues = metric(visibleDays, 'sleepAvgHrv');
  const readinessValues = metric(visibleDays, 'readinessScore');
  const temperatureValues = metric(visibleDays, 'temperatureDeviation');
  const restingHrValues = metric(visibleDays, 'restingHeartRate');
  const stepsValues = metric(visibleDays, 'steps');
  const stressValues = metric(visibleDays, 'stressHighSeconds');
  const recoveryValues = metric(visibleDays, 'recoveryHighSeconds');
  const efficiencyValues = metric(visibleDays, 'sleepEfficiency');
  const latencyValues = useMemo(
    () => visibleDays.map(day => latencyMinutes(day.sleepLatencySeconds)),
    [visibleDays],
  );
  const deepFirstThirdValues = metric(visibleDays, 'deepSleepFirstThirdMinutes');
  const activityScoreValues = metric(visibleDays, 'activityScore');
  const activeCaloriesValues = metric(visibleDays, 'activeCalories');
  const showSleepGroup = hasAny(sleepScoreValues) || hasAny(deepSleepValues) || hasAny(hrvValues)
    || hasAny(efficiencyValues) || hasAny(latencyValues) || hasAny(deepFirstThirdValues);
  const showRecoveryGroup = hasAny(readinessValues) || hasAny(temperatureValues) || hasAny(restingHrValues);
  const showActivityGroup = hasAny(stepsValues) || hasAny(stressValues) || hasAny(recoveryValues)
    || hasAny(activityScoreValues) || hasAny(activeCaloriesValues);
  const showLongGroup = summary?.days.some(day => day.vo2Max !== null || day.cardiovascularAge !== null || day.resilienceLevel) ?? false;

  if (loading && !summary) {
    return <StateCard title="Loading Oura stats" body="Fetching your latest daily health summary." />;
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-[rgba(var(--red-border-soft-rgb),0.22)] bg-[rgba(var(--red-border-soft-rgb),0.08)] p-5">
        <div className="text-base font-bold text-[var(--red-text-soft)]">Oura stats unavailable</div>
        <p className="mt-2 text-sm text-[var(--chip-text)]">{error}</p>
        <Button className="mt-4" size="sm" onClick={load} loading={loading}>Retry</Button>
      </div>
    );
  }

  if (summary && !summary.connected) {
    return <StateCard title="Connect Oura in Settings to see your health stats" body="Your recovery and trend charts appear here after Oura is connected." action="Open Settings" />;
  }

  if (summary && summary.days.length === 0) {
    return <StateCard title="No data yet" body="Run a sync from Settings to bring in your Oura history." action="Open Settings" />;
  }

  if (!summary) return null;

  return (
    <div className="flex flex-col gap-4">
      <div
        className={[
          'rounded-full border px-3 py-2 text-xs font-bold',
          freshness.stale
            ? 'border-[rgba(var(--yellow-rgb),0.28)] bg-[rgba(var(--yellow-rgb),0.1)] text-[var(--yellow)]'
            : 'border-[rgba(var(--green-rgb),0.22)] bg-[rgba(var(--green-rgb),0.08)] text-[var(--green)]',
        ].join(' ')}
      >
        {freshness.label}
        {summary.battery?.level != null && ` · Battery ${summary.battery.level}%${summary.battery.charging ? ' charging' : ''}`}
        {freshness.stale && <span className="ml-2 font-semibold text-[var(--muted)]">Data may be stale — sync runs every 6h.</span>}
      </div>

      <NightCard days={summary.days} />
      <DayCard days={summary.days} />
      <PulseDayCard />

      <section className="rounded-2xl border border-[rgba(var(--overlay-rgb),0.08)] bg-[var(--surface)] p-4">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <div className="text-xs font-bold uppercase tracking-widest text-[var(--muted)]">Trends</div>
            <h2 className="mt-1 text-lg font-extrabold text-[var(--text)]">Daily bars</h2>
          </div>
          <div className="flex rounded-xl bg-[var(--bg)] p-1">
            {([7, 30, 90] as const).map(value => (
              <button
                key={value}
                type="button"
                onClick={() => setPeriod(value)}
                className={[
                  'rounded-lg px-3 py-1.5 text-xs font-bold transition-colors',
                  period === value ? 'bg-[var(--blue)] text-[var(--blue-on)]' : 'text-[var(--muted)] hover:text-[var(--text)]',
                ].join(' ')}
              >
                {value}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-4">
          {showSleepGroup && (
          <TrendGroup title="Sleep">
            <TrendChart title="Sleep score" dates={labels} values={sleepScoreValues} lowWearMask={lowWearMask} fixedDomain={[0, 100]} />
            <TrendChart title="Deep sleep minutes" dates={labels} values={deepSleepValues} lowWearMask={lowWearMask} valueSuffix=" min" />
            <TrendChart title="Night HRV" dates={labels} values={hrvValues} lowWearMask={lowWearMask} valueSuffix=" ms" />
            <TrendChart title="Sleep efficiency" dates={labels} values={efficiencyValues} lowWearMask={lowWearMask} fixedDomain={[0, 100]} valueSuffix="%" />
            <TrendChart title="Sleep latency" dates={labels} values={latencyValues} lowWearMask={lowWearMask} valueSuffix=" min" />
            <TrendChart title="Deep sleep, first ⅓" dates={labels} values={deepFirstThirdValues} lowWearMask={lowWearMask} valueSuffix=" min" />
          </TrendGroup>
          )}

          {showRecoveryGroup && (
          <TrendGroup title="Recovery">
            <TrendChart title="Readiness score" dates={labels} values={readinessValues} lowWearMask={lowWearMask} fixedDomain={[0, 100]} />
            <TrendChart title="Temperature deviation" dates={labels} values={temperatureValues} lowWearMask={lowWearMask} mode="diverging" valueSuffix=" °C" />
            <TrendChart title="Resting HR" dates={labels} values={restingHrValues} lowWearMask={lowWearMask} valueSuffix=" bpm" />
          </TrendGroup>
          )}

          {showActivityGroup && (
          <TrendGroup title="Activity">
            <TrendChart title="Steps" dates={labels} values={stepsValues} lowWearMask={lowWearMask} />
            <TrendChart title="Activity score" dates={labels} values={activityScoreValues} lowWearMask={lowWearMask} fixedDomain={[0, 100]} />
            <TrendChart title="Active calories" dates={labels} values={activeCaloriesValues} lowWearMask={lowWearMask} valueSuffix=" kcal" />
            <TrendChart
              title="High stress vs recovery"
              dates={labels}
              values={stressValues}
              secondaryValues={recoveryValues}
              lowWearMask={lowWearMask}
              mode="paired"
              valueSuffix="s"
            />
          </TrendGroup>
          )}

          {showLongGroup && (
          <div>
            <div className="mb-2 text-xs font-bold uppercase tracking-widest text-[var(--muted)]">Long-horizon</div>
            <div className="grid gap-3 md:grid-cols-3">
              <LongMetricTile title="VO₂ max" metric="vo2Max" days={summary.days} period={period} />
              <LongMetricTile title="Cardio age" metric="cardiovascularAge" days={summary.days} period={period} />
              <ResilienceTile days={summary.days} period={period} />
            </div>
          </div>
          )}
        </div>
      </section>
    </div>
  );
}

function TrendGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-xs font-bold uppercase tracking-widest text-[var(--muted)]">{title}</div>
      <div className="grid gap-3 lg:grid-cols-3">{children}</div>
    </div>
  );
}
