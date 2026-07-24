'use client';

import {
  classifyDelta,
  latencyMinutes,
  medianOfPreviousDays,
  OURA_METRIC_EXPLAINERS,
  pickDisplayNight,
  type OuraMetricKey,
  type OuraStatsDay,
} from '@/lib/health/ouraStats';

function fmt(value: number | null | undefined, suffix = ''): string {
  if (value === null || value === undefined) return '—';
  const rounded = Math.abs(value) >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded}${suffix}`;
}

function fmtSignedDecimal(value: number | null | undefined, suffix = ''): string {
  if (value === null || value === undefined) return '—';
  const fixed = (Math.round(value * 10) / 10).toFixed(1);
  const signed = value > 0 ? `+${fixed}` : fixed;
  return `${signed}${suffix}`;
}

function dateLabel(localDate: string): string {
  const date = new Date(`${localDate}T00:00:00.000Z`);
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(date);
}

function toneClass(tone: string): string {
  if (tone === 'positive') return 'text-[var(--green)]';
  if (tone === 'negative') return 'text-[var(--red)]';
  if (tone === 'warning') return 'text-[var(--yellow)]';
  return 'text-[var(--muted)]';
}

function DeltaChip({ day, index, metric, transform }: {
  day: OuraStatsDay;
  index: number;
  metric: OuraMetricKey;
  // Applied to BOTH the value and the norm before the delta is classified;
  // used to show sleep-latency delta in minutes while stored in seconds.
  transform?: (value: number | null | undefined) => number | null;
}) {
  const rawNorm = medianOfPreviousDays((day as OuraStatsDay & { __allDays?: OuraStatsDay[] }).__allDays ?? [], index, metric);
  const rawValue = typeof day[metric] === 'number' ? (day[metric] as number) : null;
  const norm = transform ? transform(rawNorm) : rawNorm;
  const value = transform ? transform(rawValue) : rawValue;
  const delta = classifyDelta(metric, value, norm);
  if (delta.delta === null) return null;
  const sign = delta.delta > 0 ? '+' : '';
  return (
    <span className={`font-mono text-[12.5px] font-semibold tabular-nums ${toneClass(delta.tone)}`}>
      {sign}{fmt(delta.delta)}
    </span>
  );
}

function DetailRow({ label, value, suffix, metric, day, index, hint, formatter = fmt, transform }: {
  label: string;
  value: number | null | undefined;
  suffix?: string;
  metric: OuraMetricKey;
  day: OuraStatsDay;
  index: number;
  hint?: string;
  formatter?: (value: number | null | undefined, suffix?: string) => string;
  transform?: (value: number | null | undefined) => number | null;
}) {
  return (
    <div className="border-b border-[var(--border)] py-2 last:border-b-0">
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-[12.5px] text-[var(--muted)]">{label}</span>
        <span className="ml-auto font-mono text-[12.5px] font-semibold tabular-nums text-[var(--text)]">{formatter(value, suffix)}</span>
        <DeltaChip day={day} index={index} metric={metric} transform={transform} />
      </div>
      {hint && <p className="mt-0.5 text-[10.5px] leading-snug text-[var(--faint)]">{hint}</p>}
    </div>
  );
}

export function NightCard({ days }: { days: OuraStatsDay[] }) {
  const display = pickDisplayNight(days);
  if (!display.day) {
    return (
      <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="text-sm font-bold text-[var(--text)]">No sleep data yet</div>
        <p className="mt-1 text-sm text-[var(--muted)]">Run a sync from Settings to fill in your latest night.</p>
      </section>
    );
  }

  const day = { ...display.day, __allDays: days };
  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="text-xs text-[var(--muted)]">Last night · Oura</div>
        {display.isFallback && (
          <span className="font-mono text-[10px] tabular-nums text-[var(--faint)]">
            night of {dateLabel(day.localDate)}
          </span>
        )}
      </div>

      <div>
        <DetailRow label="Sleep" value={day.sleepScore} metric="sleepScore" day={day} index={display.index} />
        <DetailRow label="Readiness" value={day.readinessScore} metric="readinessScore" day={day} index={display.index} />
        <DetailRow label="Night HRV" value={day.sleepAvgHrv} suffix=" ms" metric="sleepAvgHrv" day={day} index={display.index} />
        <DetailRow label="Temperature" value={day.temperatureDeviation} suffix=" °C" metric="temperatureDeviation" day={day} index={display.index} formatter={fmtSignedDecimal} />
        <DetailRow label="Deep sleep" value={day.deepSleepMinutes} suffix=" min" metric="deepSleepMinutes" day={day} index={display.index} />
        <DetailRow label="REM" value={day.remSleepMinutes} suffix=" min" metric="remSleepMinutes" day={day} index={display.index} />
        <DetailRow
          label="Sleep efficiency"
          value={day.sleepEfficiency}
          suffix="%"
          metric="sleepEfficiency"
          day={day}
          index={display.index}
          hint={OURA_METRIC_EXPLAINERS.sleepEfficiency}
        />
        <DetailRow
          label="Sleep latency"
          value={latencyMinutes(day.sleepLatencySeconds)}
          suffix=" min"
          metric="sleepLatencySeconds"
          day={day}
          index={display.index}
          hint={OURA_METRIC_EXPLAINERS.sleepLatencySeconds}
          transform={latencyMinutes}
        />
        <DetailRow
          label="Deep sleep, first ⅓"
          value={day.deepSleepFirstThirdMinutes}
          suffix=" min"
          metric="deepSleepFirstThirdMinutes"
          day={day}
          index={display.index}
          hint={OURA_METRIC_EXPLAINERS.deepSleepFirstThirdMinutes}
        />
        <DetailRow label="Time to first deep" value={day.minutesToFirstDeepSleep} suffix=" min" metric="minutesToFirstDeepSleep" day={day} index={display.index} />
        <DetailRow label="Overnight HRV recovery" value={day.hrvRecoveryDelta} metric="hrvRecoveryDelta" day={day} index={display.index} />
        <DetailRow
          label="Temperature trend"
          value={day.temperatureTrendDeviation}
          suffix=" °C"
          metric="temperatureTrendDeviation"
          day={day}
          index={display.index}
          hint={OURA_METRIC_EXPLAINERS.temperatureTrendDeviation}
          formatter={fmtSignedDecimal}
        />
        <DetailRow label="Resting HR" value={day.restingHeartRate} suffix=" bpm" metric="restingHeartRate" day={day} index={display.index} />
        <DetailRow label="Respiratory rate" value={day.respiratoryRate} metric="respiratoryRate" day={day} index={display.index} />
        <DetailRow label="SpO₂" value={day.averageSpo2} suffix="%" metric="averageSpo2" day={day} index={display.index} />
        <DetailRow label="Breathing disturbance" value={day.breathingDisturbanceIndex} metric="breathingDisturbanceIndex" day={day} index={display.index} />
      </div>
    </section>
  );
}
