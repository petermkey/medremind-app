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
  if (tone === 'positive') return 'text-[#8fae74] bg-[rgba(143,174,116,0.12)]';
  if (tone === 'negative') return 'text-[#d98a7c] bg-[rgba(217,138,124,0.12)]';
  if (tone === 'warning') return 'text-[#cf8148] bg-[rgba(207,129,72,0.12)]';
  return 'text-[#9b978f] bg-[#191d22]';
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
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${toneClass(delta.tone)}`}>
      {sign}{fmt(delta.delta)}
    </span>
  );
}

function HeroTile({
  label,
  value,
  suffix,
  metric,
  day,
  index,
  formatter = fmt,
}: {
  label: string;
  value: number | null | undefined;
  suffix?: string;
  metric: OuraMetricKey;
  day: OuraStatsDay;
  index: number;
  formatter?: (value: number | null | undefined, suffix?: string) => string;
}) {
  const delta = classifyDelta(metric, typeof value === 'number' ? value : null, medianOfPreviousDays((day as OuraStatsDay & { __allDays?: OuraStatsDay[] }).__allDays ?? [], index, metric));
  return (
    <div className="rounded-xl border border-[rgba(255,255,255,0.07)] bg-[#0e1013] p-3">
      <div className="text-[10px] font-bold uppercase tracking-widest text-[#9b978f]">{label}</div>
      <div className="mt-2 text-2xl font-extrabold text-[#e8e6e1]">{formatter(value, suffix)}</div>
      {delta.delta !== null && (
        <div className={`mt-2 inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${toneClass(delta.tone)}`}>
          {delta.delta > 0 ? '+' : ''}{fmt(delta.delta)} vs norm
        </div>
      )}
    </div>
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
    <div className="border-b border-[rgba(255,255,255,0.06)] py-2 last:border-b-0">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-[#c4c0b8]">{label}</span>
        <span className="ml-auto text-sm font-bold text-[#e8e6e1]">{formatter(value, suffix)}</span>
        <DeltaChip day={day} index={index} metric={metric} transform={transform} />
      </div>
      {hint && <p className="mt-0.5 text-[11px] leading-snug text-[#9b978f]">{hint}</p>}
    </div>
  );
}

export function NightCard({ days }: { days: OuraStatsDay[] }) {
  const display = pickDisplayNight(days);
  if (!display.day) {
    return (
      <section className="rounded-2xl border border-[rgba(255,255,255,0.08)] bg-[#14171b] p-4">
        <div className="text-sm font-bold text-[#e8e6e1]">No sleep data yet</div>
        <p className="mt-1 text-sm text-[#9b978f]">Run a sync from Settings to fill in your latest night.</p>
      </section>
    );
  }

  const day = { ...display.day, __allDays: days };
  return (
    <section className="rounded-2xl border border-[rgba(255,255,255,0.08)] bg-[#14171b] p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <div className="text-xs font-bold uppercase tracking-widest text-[#9b978f]">Last night</div>
          <h2 className="mt-1 text-lg font-extrabold text-[#e8e6e1]">Recovery snapshot</h2>
        </div>
        {display.isFallback && (
          <span className="rounded-full bg-[#191d22] px-3 py-1 text-xs font-bold text-[#cf8148]">
            Night of {dateLabel(day.localDate)}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <HeroTile label="Sleep" value={day.sleepScore} metric="sleepScore" day={day} index={display.index} />
        <HeroTile label="Readiness" value={day.readinessScore} metric="readinessScore" day={day} index={display.index} />
        <HeroTile label="Night HRV" value={day.sleepAvgHrv} suffix=" ms" metric="sleepAvgHrv" day={day} index={display.index} />
        <HeroTile label="Temperature" value={day.temperatureDeviation} suffix=" °C" metric="temperatureDeviation" day={day} index={display.index} formatter={fmtSignedDecimal} />
      </div>

      <div className="mt-4 rounded-xl bg-[#0e1013] px-3">
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
