'use client';

import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { PulseDayChart, type PulseDose, type PulsePoint, type PulseTag } from './PulseDayChart';

type PulseDayResponse = {
  date: string;
  startIso: string;
  endIso: string;
  points: PulsePoint[];
  tags: PulseTag[];
  doses: PulseDose[];
  error?: string;
};

const LEGEND: Array<{ color: string; label: string }> = [
  { color: '#F59E0B', label: 'Caffeine' },
  { color: '#8B5CF6', label: 'Alcohol' },
  { color: '#F97316', label: 'Sauna' },
  { color: '#3B82F6', label: 'Dose taken' },
];

function todayLocalDate(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

function shiftDate(localDate: string, deltaDays: number): string {
  const date = new Date(`${localDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + deltaDays);
  return date.toISOString().slice(0, 10);
}

export function PulseDayCard() {
  const [date, setDate] = useState(todayLocalDate);
  const [data, setData] = useState<PulseDayResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (targetDate: string) => {
    setLoading(true);
    setError('');
    try {
      const tzOffset = new Date().getTimezoneOffset();
      const response = await fetch(`/api/health/oura/heartrate-day?date=${targetDate}&tzOffset=${tzOffset}`);
      const payload = (await response.json()) as PulseDayResponse;
      if (!response.ok) throw new Error(payload.error ?? 'Pulse day unavailable.');
      setData(payload);
    } catch (err) {
      setData(null);
      setError(err instanceof Error ? err.message : 'Pulse day unavailable.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(date);
  }, [date, load]);

  const today = todayLocalDate();

  return (
    <section className="rounded-2xl border border-[rgba(255,255,255,0.08)] bg-[#161B22] p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-xs font-bold uppercase tracking-widest text-[#8B949E]">Intraday heart rate</div>
          <h2 className="mt-1 text-lg font-extrabold text-[#F0F6FC]">Пульс дня</h2>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Previous day"
            onClick={() => setDate(current => shiftDate(current, -1))}
            className="rounded-lg bg-[#0D1117] px-2.5 py-1.5 text-sm font-bold text-[#8B949E] hover:text-[#F0F6FC]"
          >
            ‹
          </button>
          <input
            type="date"
            aria-label="Pulse day date"
            value={date}
            max={today}
            onChange={(event) => {
              if (event.target.value) setDate(event.target.value);
            }}
            className="rounded-lg bg-[#0D1117] px-2 py-1.5 text-xs font-semibold text-[#F0F6FC] [color-scheme:dark]"
          />
          <button
            type="button"
            aria-label="Next day"
            disabled={date >= today}
            onClick={() => setDate(current => shiftDate(current, 1))}
            className="rounded-lg bg-[#0D1117] px-2.5 py-1.5 text-sm font-bold text-[#8B949E] hover:text-[#F0F6FC] disabled:opacity-40"
          >
            ›
          </button>
        </div>
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-3">
        {LEGEND.map(item => (
          <span key={item.label} className="flex items-center gap-1 text-[10px] font-semibold text-[#8B949E]">
            <span className="h-2 w-2 rounded-full" style={{ background: item.color }} />
            {item.label}
          </span>
        ))}
      </div>

      {loading && <p className="text-sm text-[#8B949E]">Loading heart-rate samples...</p>}
      {!loading && error && (
        <div>
          <p className="text-sm text-[#FCA5A5]">{error}</p>
          <Button className="mt-3" size="sm" onClick={() => load(date)}>Retry</Button>
        </div>
      )}
      {!loading && !error && data && (
        <PulseDayChart
          points={data.points}
          tags={data.tags}
          doses={data.doses}
          startIso={data.startIso}
          endIso={data.endIso}
        />
      )}
    </section>
  );
}
