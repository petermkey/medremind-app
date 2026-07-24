'use client';

import {
  classifyDelta,
  medianOfPreviousDays,
  OURA_METRIC_EXPLAINERS,
  pickDisplayDay,
  type OuraMetricKey,
  type OuraStatsDay,
} from '@/lib/health/ouraStats';

function fmt(value: number | null | undefined, suffix = ''): string {
  if (value === null || value === undefined) return '—';
  const rounded = Math.abs(value) >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded}${suffix}`;
}

function dateLabel(localDate: string): string {
  const date = new Date(`${localDate}T00:00:00.000Z`);
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(date);
}

function toneClass(tone: string): string {
  if (tone === 'positive') return 'text-[var(--green)] bg-[rgba(var(--green-rgb),0.12)]';
  if (tone === 'negative') return 'text-[var(--red-border-soft)] bg-[rgba(var(--red-border-soft-rgb),0.12)]';
  if (tone === 'warning') return 'text-[var(--yellow)] bg-[rgba(var(--yellow-rgb),0.12)]';
  return 'text-[var(--muted)] bg-[var(--surface2)]';
}

function DayTile({ label, value, suffix, metric, days, index, hint }: {
  label: string;
  value: number | null | undefined;
  suffix?: string;
  metric: OuraMetricKey;
  days: OuraStatsDay[];
  index: number;
  hint: string;
}) {
  const numericValue = typeof value === 'number' ? value : null;
  const delta = classifyDelta(metric, numericValue, medianOfPreviousDays(days, index, metric));
  return (
    <div className="rounded-xl border border-[rgba(var(--overlay-rgb),0.07)] bg-[var(--bg)] p-3">
      <div className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">{label}</div>
      <div className="mt-2 text-2xl font-extrabold text-[var(--text)]">{fmt(value, suffix)}</div>
      {delta.delta !== null && (
        <div className={`mt-2 inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${toneClass(delta.tone)}`}>
          {delta.delta > 0 ? '+' : ''}{fmt(delta.delta)} vs norm
        </div>
      )}
      <p className="mt-2 text-[11px] leading-snug text-[var(--muted)]">{hint}</p>
    </div>
  );
}

export function DayCard({ days }: { days: OuraStatsDay[] }) {
  const display = pickDisplayDay(days);
  if (!display.day) return null;
  const day = display.day;
  const workoutCount = typeof day.workoutCount === 'number' ? day.workoutCount : null;

  return (
    <section className="rounded-2xl border border-[rgba(var(--overlay-rgb),0.08)] bg-[var(--surface)] p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <div className="text-xs font-bold uppercase tracking-widest text-[var(--muted)]">Daily strain</div>
          <h2 className="mt-1 text-lg font-extrabold text-[var(--text)]">Day recap</h2>
        </div>
        {display.isFallback && (
          <span className="rounded-full bg-[var(--surface2)] px-3 py-1 text-xs font-bold text-[var(--yellow)]">
            {dateLabel(day.localDate)}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <DayTile label="Activity score" value={day.activityScore} metric="activityScore" days={days} index={display.index} hint={OURA_METRIC_EXPLAINERS.activityScore} />
        <DayTile label="Workouts" value={workoutCount} metric="workoutCount" days={days} index={display.index} hint={OURA_METRIC_EXPLAINERS.workoutCount} />
        <DayTile label="Active calories" value={day.activeCalories} suffix=" kcal" metric="activeCalories" days={days} index={display.index} hint={OURA_METRIC_EXPLAINERS.activeCalories} />
        <DayTile label="Total calories" value={day.totalCalories} suffix=" kcal" metric="totalCalories" days={days} index={display.index} hint={OURA_METRIC_EXPLAINERS.totalCalories} />
      </div>

      {day.hrvBalance && (
        <div className="mt-3 rounded-xl bg-[var(--bg)] p-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-[var(--chip-text)]">HRV balance</span>
            <span className="text-sm font-bold capitalize text-[var(--text)]">{day.hrvBalance}</span>
          </div>
          <p className="mt-0.5 text-[11px] leading-snug text-[var(--muted)]">{OURA_METRIC_EXPLAINERS.hrvBalance}</p>
        </div>
      )}
    </section>
  );
}
