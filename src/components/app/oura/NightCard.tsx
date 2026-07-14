'use client';

import { classifyDelta, medianOfPreviousDays, pickDisplayNight, type OuraMetricKey, type OuraStatsDay } from '@/lib/health/ouraStats';

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
  if (tone === 'positive') return 'text-[#10B981] bg-[rgba(16,185,129,0.12)]';
  if (tone === 'negative') return 'text-[#F87171] bg-[rgba(248,113,113,0.12)]';
  if (tone === 'warning') return 'text-[#FBBF24] bg-[rgba(251,191,36,0.12)]';
  return 'text-[#8B949E] bg-[#1C2333]';
}

function DeltaChip({ day, index, metric }: { day: OuraStatsDay; index: number; metric: OuraMetricKey }) {
  const norm = medianOfPreviousDays((day as OuraStatsDay & { __allDays?: OuraStatsDay[] }).__allDays ?? [], index, metric);
  const value = typeof day[metric] === 'number' ? day[metric] : null;
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
    <div className="rounded-xl border border-[rgba(255,255,255,0.07)] bg-[#0D1117] p-3">
      <div className="text-[10px] font-bold uppercase tracking-widest text-[#8B949E]">{label}</div>
      <div className="mt-2 text-2xl font-extrabold text-[#F0F6FC]">{formatter(value, suffix)}</div>
      {delta.delta !== null && (
        <div className={`mt-2 inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${toneClass(delta.tone)}`}>
          {delta.delta > 0 ? '+' : ''}{fmt(delta.delta)} vs norm
        </div>
      )}
    </div>
  );
}

function DetailRow({ label, value, suffix, metric, day, index }: {
  label: string;
  value: number | null | undefined;
  suffix?: string;
  metric: OuraMetricKey;
  day: OuraStatsDay;
  index: number;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-[rgba(255,255,255,0.06)] py-2 last:border-b-0">
      <span className="text-sm text-[#C9D1D9]">{label}</span>
      <span className="ml-auto text-sm font-bold text-[#F0F6FC]">{fmt(value, suffix)}</span>
      <DeltaChip day={day} index={index} metric={metric} />
    </div>
  );
}

export function NightCard({ days }: { days: OuraStatsDay[] }) {
  const display = pickDisplayNight(days);
  if (!display.day) {
    return (
      <section className="rounded-2xl border border-[rgba(255,255,255,0.08)] bg-[#161B22] p-4">
        <div className="text-sm font-bold text-[#F0F6FC]">No sleep data yet</div>
        <p className="mt-1 text-sm text-[#8B949E]">Run a sync from Settings to fill in your latest night.</p>
      </section>
    );
  }

  const day = { ...display.day, __allDays: days };
  return (
    <section className="rounded-2xl border border-[rgba(255,255,255,0.08)] bg-[#161B22] p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <div className="text-xs font-bold uppercase tracking-widest text-[#8B949E]">Last night</div>
          <h2 className="mt-1 text-lg font-extrabold text-[#F0F6FC]">Recovery snapshot</h2>
        </div>
        {display.isFallback && (
          <span className="rounded-full bg-[#1C2333] px-3 py-1 text-xs font-bold text-[#FBBF24]">
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

      <div className="mt-4 rounded-xl bg-[#0D1117] px-3">
        <DetailRow label="Deep sleep" value={day.deepSleepMinutes} suffix=" min" metric="deepSleepMinutes" day={day} index={display.index} />
        <DetailRow label="REM" value={day.remSleepMinutes} suffix=" min" metric="remSleepMinutes" day={day} index={display.index} />
        <DetailRow label="Time to first deep" value={day.minutesToFirstDeepSleep} suffix=" min" metric="minutesToFirstDeepSleep" day={day} index={display.index} />
        <DetailRow label="Overnight HRV recovery" value={day.hrvRecoveryDelta} metric="hrvRecoveryDelta" day={day} index={display.index} />
        <DetailRow label="Resting HR" value={day.restingHeartRate} suffix=" bpm" metric="restingHeartRate" day={day} index={display.index} />
        <DetailRow label="Respiratory rate" value={day.respiratoryRate} metric="respiratoryRate" day={day} index={display.index} />
        <DetailRow label="SpO₂" value={day.averageSpo2} suffix="%" metric="averageSpo2" day={day} index={display.index} />
        <DetailRow label="Breathing disturbance" value={day.breathingDisturbanceIndex} metric="breathingDisturbanceIndex" day={day} index={display.index} />
      </div>
    </section>
  );
}
