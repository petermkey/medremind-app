'use client';
import { useMemo } from 'react';
import { format, subDays, eachDayOfInterval } from 'date-fns';
import { useStore } from '@/lib/store/store';

function pctToColor(pct: number) {
  if (pct === 0) return '#1C2333';
  if (pct < 50) return '#EF4444';
  if (pct < 80) return '#FBBF24';
  return '#10B981';
}

export default function ProgressPage() {
  const { scheduledDoses, activeProtocols, getAdherencePct, getStreak } = useStore();

  const today = new Date();
  const todayStr = format(today, 'yyyy-MM-dd');

  // Last 30 days for heatmap
  const days30 = eachDayOfInterval({ start: subDays(today, 29), end: today });

  const stats = useMemo(() => {
    const total = scheduledDoses.length;
    const taken = scheduledDoses.filter(d => d.status === 'taken').length;
    const skipped = scheduledDoses.filter(d => d.status === 'skipped').length;
    const overdue = scheduledDoses.filter(d => d.status === 'overdue').length;
    const pct = total ? Math.round(taken / total * 100) : 0;
    return { total, taken, skipped, overdue, pct };
  }, [scheduledDoses]);

  // Weekly (last 7 days) adherence per day
  const weeklyData = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = subDays(today, 6 - i);
      const dateStr = format(d, 'yyyy-MM-dd');
      return { date: dateStr, label: format(d, 'EEE'), pct: getAdherencePct(dateStr) };
    });
  }, [scheduledDoses]);

  const streak = getStreak();

  const activeCount = activeProtocols.filter(ap => ap.status === 'active').length;

  return (
    <div className="flex flex-col h-full">
      <div className="px-5 pt-4 pb-2 flex-shrink-0">
        <h1 className="text-xl font-extrabold text-[#F0F6FC]">Progress</h1>
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-6">

        {/* Summary cards */}
        <div className="grid grid-cols-2 gap-3 mt-3 mb-5">
          {[
            { label: 'Overall', value: `${stats.pct}%`, color: '#3B82F6', sub: 'adherence' },
            { label: 'Streak',  value: `${streak}`,     color: '#10B981', sub: 'days' },
            { label: 'Active',  value: `${activeCount}`, color: '#8B5CF6', sub: 'protocols' },
            { label: 'Taken',   value: `${stats.taken}`, color: '#10B981', sub: `of ${stats.total}` },
          ].map(({ label, value, color, sub }) => (
            <div key={label} className="bg-[#161B22] border border-[rgba(255,255,255,0.08)] rounded-2xl p-4">
              <div className="text-2xl font-extrabold" style={{ color }}>{value}</div>
              <div className="text-xs font-semibold text-[#F0F6FC] mt-0.5">{label}</div>
              <div className="text-[11px] text-[#8B949E]">{sub}</div>
            </div>
          ))}
        </div>

        {/* Weekly bar chart */}
        <div className="bg-[#161B22] border border-[rgba(255,255,255,0.08)] rounded-2xl p-4 mb-4">
          <div className="text-xs font-bold text-[#8B949E] uppercase tracking-widest mb-4">Last 7 Days</div>
          <div className="flex items-end gap-2 h-20">
            {weeklyData.map(({ date, label, pct }) => (
              <div key={date} className="flex-1 flex flex-col items-center gap-1">
                <div className="w-full rounded-t-md transition-all duration-500" style={{ height: `${Math.max(pct, 4)}%`, background: pctToColor(pct), minHeight: 4 }} />
                <span className="text-[10px] text-[#8B949E]">{label}</span>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-3 mt-3 text-[11px] text-[#8B949E]">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#10B981] inline-block" /> 80%+</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#FBBF24] inline-block" /> 50-79%</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#EF4444] inline-block" /> &lt;50%</span>
          </div>
        </div>

        {/* 30-day heatmap */}
        <div className="bg-[#161B22] border border-[rgba(255,255,255,0.08)] rounded-2xl p-4 mb-4">
          <div className="text-xs font-bold text-[#8B949E] uppercase tracking-widest mb-4">30-Day Adherence</div>
          <div className="grid gap-1.5" style={{ gridTemplateColumns: 'repeat(10, 1fr)' }}>
            {days30.map(d => {
              const dateStr = format(d, 'yyyy-MM-dd');
              const pct = getAdherencePct(dateStr);
              const isToday = dateStr === todayStr;
              return (
                <div
                  key={dateStr}
                  title={`${dateStr}: ${pct}%`}
                  className={`aspect-square rounded-md transition-colors ${isToday ? 'ring-1 ring-white/30' : ''}`}
                  style={{ background: pctToColor(pct) }}
                />
              );
            })}
          </div>
          <div className="flex items-center justify-between mt-3 text-[11px] text-[#8B949E]">
            <span>{format(days30[0], 'MMM d')}</span>
            <span>Today</span>
          </div>
        </div>

        {/* Per-protocol breakdown */}
        {activeProtocols.length > 0 && (
          <div className="bg-[#161B22] border border-[rgba(255,255,255,0.08)] rounded-2xl p-4">
            <div className="text-xs font-bold text-[#8B949E] uppercase tracking-widest mb-4">By Protocol</div>
            {activeProtocols.map(ap => {
              const doses = scheduledDoses.filter(d => d.activeProtocolId === ap.id);
              const taken = doses.filter(d => d.status === 'taken').length;
              const pct = doses.length ? Math.round(taken / doses.length * 100) : 0;
              const barColor = pctToColor(pct);
              return (
                <div key={ap.id} className="mb-4 last:mb-0">
                  <div className="flex justify-between mb-1.5">
                    <span className="text-sm font-semibold text-[#F0F6FC]">{ap.protocol.name}</span>
                    <span className="text-sm font-bold" style={{ color: barColor }}>{pct}%</span>
                  </div>
                  <div className="h-2 bg-[#1C2333] rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: barColor }} />
                  </div>
                  <div className="text-[11px] text-[#8B949E] mt-1">{taken} of {doses.length} doses taken · {ap.status}</div>
                </div>
              );
            })}
          </div>
        )}

        {scheduledDoses.length === 0 && (
          <div className="text-center py-10">
            <div className="text-4xl mb-3">📊</div>
            <div className="text-sm font-bold text-[#F0F6FC] mb-1">No data yet</div>
            <div className="text-xs text-[#8B949E]">Activate a protocol to start tracking your adherence.</div>
          </div>
        )}
      </div>
    </div>
  );
}
