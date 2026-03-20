'use client';
import { useEffect, useMemo, useState } from 'react';
import { addDays, eachDayOfInterval, format, subDays } from 'date-fns';
import { useStore } from '@/lib/store/store';

function pctToColor(pct: number) {
  if (pct === 0) return '#1C2333';
  if (pct < 50) return '#EF4444';
  if (pct < 80) return '#FBBF24';
  return '#10B981';
}

const RING_COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EC4899', '#8B5CF6', '#EF4444'];

type RingDatum = {
  key: string;
  color: string;
  pct: number;
  total: number;
};

function DayRings({
  rings,
  size = 44,
  stroke = 4,
}: {
  rings: RingDatum[];
  size?: number;
  stroke?: number;
}) {
  const count = Math.max(rings.length, 1);
  const gap = 2;
  const maxRadius = size / 2 - stroke / 2;
  const minRadius = Math.max(2, maxRadius - (count - 1) * (stroke + gap));
  const radii =
    count === 1
      ? [maxRadius]
      : Array.from({ length: count }, (_, i) => maxRadius - i * ((maxRadius - minRadius) / (count - 1)));

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="overflow-visible">
      {rings.map((ring, idx) => {
        const radius = radii[idx] ?? minRadius;
        const circumference = 2 * Math.PI * radius;
        const progress = Math.max(0, Math.min(100, ring.pct));
        const dashOffset = circumference * (1 - progress / 100);
        const isHollow = ring.total === 0 || progress === 0;

        return (
          <g key={ring.key}>
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={ring.color}
              strokeOpacity={ring.total > 0 ? 0.35 : 0.18}
              strokeWidth={stroke}
            />
            {!isHollow && (
              <circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={ring.color}
                strokeWidth={stroke}
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={dashOffset}
                transform={`rotate(-90 ${size / 2} ${size / 2})`}
              />
            )}
          </g>
        );
      })}
    </svg>
  );
}

function getAdherenceStatus(pct: number, hasData: boolean): {
  label: string;
  color: string;
  borderColor: string;
  bgColor: string;
} {
  if (!hasData) return {
    label: 'No data yet',
    color: '#8B949E',
    borderColor: 'rgba(139,92,246,0.12)',
    bgColor: 'rgba(139,92,246,0.05)',
  };
  if (pct >= 80) return {
    label: 'On track',
    color: '#10B981',
    borderColor: 'rgba(16,185,129,0.22)',
    bgColor: 'rgba(16,185,129,0.08)',
  };
  if (pct >= 50) return {
    label: 'Needs attention',
    color: '#FBBF24',
    borderColor: 'rgba(251,191,36,0.22)',
    bgColor: 'rgba(251,191,36,0.08)',
  };
  return {
    label: 'Off track',
    color: '#EF4444',
    borderColor: 'rgba(239,68,68,0.22)',
    bgColor: 'rgba(239,68,68,0.08)',
  };
}

function heatmapCellBg(pct: number, total: number, isFuture: boolean): string {
  if (isFuture || total === 0) return 'transparent';
  if (pct >= 80) return 'rgba(16,185,129,0.18)';
  if (pct >= 50) return 'rgba(251,191,36,0.18)';
  return 'rgba(239,68,68,0.18)';
}

function heatmapCellBorder(pct: number, total: number, isFuture: boolean): string {
  if (isFuture || total === 0) return 'rgba(255,255,255,0.04)';
  if (pct >= 80) return 'rgba(16,185,129,0.32)';
  if (pct >= 50) return 'rgba(251,191,36,0.32)';
  return 'rgba(239,68,68,0.32)';
}

export default function ProgressPage() {
  const {
    activeProtocols,
    getStreak,
    selectProgressSummaryForDates,
    selectProgressDayProtocolStats,
    selectProgressDayStatus,
    selectProgressProtocolWeights,
  } = useStore();
  const [calendarRange, setCalendarRange] = useState<30 | 60 | 90>(30);
  const [isMobile, setIsMobile] = useState(false);

  const today = new Date();
  const todayStr = format(today, 'yyyy-MM-dd');

  useEffect(() => {
    const update = () => setIsMobile(window.innerWidth < 640);
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  const futureDays = Math.floor(calendarRange / 3);
  const pastDays = calendarRange - 1 - futureDays;
  const calendarDays = eachDayOfInterval({ start: subDays(today, pastDays), end: addDays(today, futureDays) });
  const calendarDateStrings = useMemo(
    () => calendarDays.map(d => format(d, 'yyyy-MM-dd')),
    [calendarDays],
  );

  const stats = useMemo(() => {
    return selectProgressSummaryForDates(calendarDateStrings);
  }, [calendarDateStrings, selectProgressSummaryForDates]);

  const protocolTracks = useMemo(() => {
    const protocolWeights = selectProgressProtocolWeights(calendarDateStrings);
    const withWeight = activeProtocols
      .map((ap, idx) => {
        const total = protocolWeights[ap.id] ?? 0;
        const seedColor = ap.protocol.items.find(i => i.color)?.color;
        const color =
          seedColor === 'blue' ? '#3B82F6' :
          seedColor === 'green' ? '#10B981' :
          seedColor === 'yellow' ? '#F59E0B' :
          seedColor === 'pink' ? '#EC4899' :
          seedColor === 'purple' ? '#8B5CF6' :
          seedColor === 'red' ? '#EF4444' :
          RING_COLORS[idx % RING_COLORS.length];
        return { id: ap.id, name: ap.protocol.name, color, weight: total };
      })
      .sort((a, b) => b.weight - a.weight);
    return withWeight.slice(0, 4);
  }, [activeProtocols, calendarDateStrings, selectProgressProtocolWeights]);

  const buildRingsForDate = (dateStr: string): RingDatum[] => {
    const dayStats = selectProgressDayProtocolStats(dateStr);
    const isFuture = dateStr > todayStr;
    return protocolTracks.map(track => {
      const stat = dayStats[track.id];
      const total = stat?.total ?? 0;
      const taken = stat?.taken ?? 0;
      const pct = total ? Math.round((taken / total) * 100) : 0;
      return {
        key: `${dateStr}:${track.id}`,
        color: track.color,
        pct: isFuture ? 0 : pct,
        total,
      };
    });
  };

  const weeklyData = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = subDays(today, 6 - i);
      const dateStr = format(d, 'yyyy-MM-dd');
      return { date: dateStr, label: format(d, 'EEE'), day: format(d, 'd') };
    });
  }, [today]);

  // ── Week stats for status block and trend signal ──────────────────────
  const weekStats = useMemo(() => {
    return selectProgressSummaryForDates(weeklyData.map(d => d.date));
  }, [weeklyData, selectProgressSummaryForDates]);

  const prev7DateStrings = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => format(subDays(today, 13 - i), 'yyyy-MM-dd'));
  }, [today]);

  const prevWeekStats = useMemo(() => {
    return selectProgressSummaryForDates(prev7DateStrings);
  }, [prev7DateStrings, selectProgressSummaryForDates]);

  const trendDelta = useMemo(() => {
    if (weekStats.total === 0 || prevWeekStats.total === 0) return null;
    return weekStats.pct - prevWeekStats.pct;
  }, [weekStats, prevWeekStats]);

  const adherenceStatus = useMemo(() => {
    return getAdherenceStatus(weekStats.pct, weekStats.total > 0);
  }, [weekStats]);

  // ── Calendar heatmap: overall daily adherence per cell ────────────────
  const calendarDayAdherence = useMemo(() => {
    const map: Record<string, { pct: number; total: number }> = {};
    for (const dateStr of calendarDateStrings) {
      const dayStats = selectProgressDayProtocolStats(dateStr);
      let total = 0;
      let taken = 0;
      for (const s of Object.values(dayStats)) {
        total += s.total;
        taken += s.taken;
      }
      map[dateStr] = { total, pct: total ? Math.round((taken / total) * 100) : -1 };
    }
    return map;
  }, [calendarDateStrings, selectProgressDayProtocolStats]);

  const streak = getStreak();
  const protocolBreakdownStats = useMemo(() => {
    const byProtocol: Record<string, { total: number; taken: number }> = {};
    for (const date of calendarDateStrings) {
      const dayStats = selectProgressDayProtocolStats(date);
      for (const [protocolId, stat] of Object.entries(dayStats)) {
        const current = byProtocol[protocolId] ?? { total: 0, taken: 0 };
        current.total += stat.total;
        current.taken += stat.taken;
        byProtocol[protocolId] = current;
      }
    }
    return byProtocol;
  }, [calendarDateStrings, selectProgressDayProtocolStats]);

  // ── Sort protocols: weakest adherence first ───────────────────────────
  const sortedActiveProtocols = useMemo(() => {
    return [...activeProtocols].sort((a, b) => {
      const sa = protocolBreakdownStats[a.id] ?? { total: 0, taken: 0 };
      const sb = protocolBreakdownStats[b.id] ?? { total: 0, taken: 0 };
      if (sa.total === 0 && sb.total === 0) return 0;
      if (sa.total === 0) return 1;
      if (sb.total === 0) return -1;
      return (sa.taken / sa.total) - (sb.taken / sb.total);
    });
  }, [activeProtocols, protocolBreakdownStats]);

  const activeCount = activeProtocols.filter(ap => ap.status === 'active').length;
  const todayStatus = useMemo(() => {
    return selectProgressDayStatus(todayStr);
  }, [todayStr, selectProgressDayStatus]);

  const weeklyRingSize = isMobile ? 30 : 38;
  const weeklyRingStroke = isMobile ? 3 : 3.5;
  const heatmapCellHeight = isMobile
    ? (calendarRange === 90 ? 32 : calendarRange === 60 ? 36 : 40)
    : (calendarRange === 90 ? 36 : calendarRange === 60 ? 42 : 48);

  return (
    <div className="flex flex-col h-full">
      <div className="px-5 pt-4 pb-2 flex-shrink-0">
        <h1 className="text-xl font-extrabold text-[#F0F6FC]">Progress</h1>
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-6">

        {/* ── 1. PRIMARY ADHERENCE STATUS + TREND ── */}
        <div
          className="rounded-2xl border p-4 mt-3 mb-3"
          style={{ background: adherenceStatus.bgColor, borderColor: adherenceStatus.borderColor }}
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-xl font-extrabold" style={{ color: adherenceStatus.color }}>
              {adherenceStatus.label}
            </span>
            <span className="text-2xl font-extrabold" style={{ color: adherenceStatus.color }}>
              {weekStats.total > 0 ? `${weekStats.pct}%` : '—'}
            </span>
          </div>
          <div className="text-[11px] text-[#8B949E]">
            {weekStats.total > 0
              ? `${weekStats.taken} of ${weekStats.total} doses taken this week`
              : 'No dose data for the last 7 days'}
          </div>
          {trendDelta !== null && (
            <div
              className="text-[11px] mt-1 font-semibold"
              style={{ color: trendDelta > 3 ? '#10B981' : trendDelta < -3 ? '#EF4444' : '#8B949E' }}
            >
              {trendDelta > 3
                ? `↑ +${trendDelta} pts vs last week`
                : trendDelta < -3
                ? `↓ ${Math.abs(trendDelta)} pts vs last week`
                : '→ Stable vs last week'}
            </div>
          )}
        </div>

        {/* ── 2. TODAY SUMMARY ── */}
        {(todayStatus.taken + todayStatus.remaining + todayStatus.skipped) > 0 && (
          <div className="mb-4">
          <div className="text-[10px] font-bold text-[#8B949E] uppercase tracking-widest mb-1.5">Today</div>
          <div className="flex gap-2">
            <div className="flex-1 bg-[#161B22] border border-[rgba(255,255,255,0.06)] rounded-xl px-3 py-2.5 flex items-center gap-1.5 min-w-0">
              <span className="text-[11px] font-bold text-[#10B981] flex-shrink-0">✓ {todayStatus.taken}</span>
              <span className="text-[10px] text-[#8B949E] truncate">taken</span>
            </div>
            <div className="flex-1 bg-[#161B22] border border-[rgba(255,255,255,0.06)] rounded-xl px-3 py-2.5 flex items-center gap-1.5 min-w-0">
              <span className="text-[11px] font-bold text-[#3B82F6] flex-shrink-0">→ {todayStatus.remaining}</span>
              <span className="text-[10px] text-[#8B949E] truncate">left</span>
            </div>
            <div className="flex-1 bg-[#161B22] border border-[rgba(255,255,255,0.06)] rounded-xl px-3 py-2.5 flex items-center gap-1.5 min-w-0">
              <span className="text-[11px] font-bold text-[#8B949E] flex-shrink-0">— {todayStatus.skipped}</span>
              <span className="text-[10px] text-[#8B949E] truncate">skipped</span>
            </div>
          </div>
          </div>
        )}

        {/* ── 3. SUMMARY METRICS (time-scoped labels) ── */}
        <div className="grid grid-cols-2 gap-3 mb-5">
          {[
            { label: 'Adherence', value: `${stats.pct}%`,    color: '#3B82F6', sub: `last ${calendarRange}d` },
            { label: 'Streak',    value: `${streak}`,         color: '#10B981', sub: 'days in a row' },
            { label: 'Active',    value: `${activeCount}`,    color: '#8B5CF6', sub: 'protocols' },
            { label: 'Taken',     value: `${stats.taken}`,    color: '#10B981', sub: `of ${stats.total} (${calendarRange}d)` },
          ].map(({ label, value, color, sub }) => (
            <div key={label} className="bg-[#161B22] border border-[rgba(255,255,255,0.08)] rounded-2xl p-4">
              <div className="text-2xl font-extrabold" style={{ color }}>{value}</div>
              <div className="text-xs font-semibold text-[#F0F6FC] mt-0.5">{label}</div>
              <div className="text-[11px] text-[#8B949E]">{sub}</div>
            </div>
          ))}
        </div>

        {/* ── 4. LAST 7 DAYS (weekly rings — unchanged) ── */}
        <div className="bg-[#161B22] border border-[rgba(255,255,255,0.08)] rounded-2xl p-4 mb-4">
          <div className="text-xs font-bold text-[#8B949E] uppercase tracking-widest mb-4">Last 7 Days</div>
          <div className="grid grid-cols-7 gap-2">
            {weeklyData.map(({ date, label, day }) => (
              <div key={date} className="flex flex-col items-center gap-1.5">
                <DayRings rings={buildRingsForDate(date)} size={weeklyRingSize} stroke={weeklyRingStroke} />
                <span className="text-[10px] text-[#8B949E]">{label}</span>
                <span className="text-[10px] text-[#F0F6FC] font-semibold">{day}</span>
              </div>
            ))}
          </div>
          {protocolTracks.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-3 text-[11px] text-[#8B949E]">
              {protocolTracks.map(track => (
                <span key={track.id} className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full inline-block" style={{ background: track.color }} />
                  {track.name}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* ── 5. MONTHLY PATTERN (heatmap cells) ── */}
        <div className="bg-[#161B22] border border-[rgba(255,255,255,0.08)] rounded-2xl p-4 mb-4">
          <div className="flex items-center justify-between gap-3 mb-2">
            <div className="text-xs font-bold text-[#8B949E] uppercase tracking-widest">Monthly Pattern</div>
            <div className="flex items-center gap-1">
              {([30, 60, 90] as const).map(value => (
                <button
                  key={value}
                  onClick={() => setCalendarRange(value)}
                  className={[
                    'px-2 py-1 rounded-lg text-[10px] font-semibold transition-colors',
                    calendarRange === value ? 'bg-[#3B82F6] text-white' : 'bg-[#1C2333] text-[#8B949E] hover:text-[#F0F6FC]',
                  ].join(' ')}
                >
                  {value}d
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-3 mb-3 text-[10px] text-[#8B949E]">
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-sm inline-block" style={{ background: 'rgba(16,185,129,0.18)', border: '1px solid rgba(16,185,129,0.32)' }} />
              ≥80%
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-sm inline-block" style={{ background: 'rgba(251,191,36,0.18)', border: '1px solid rgba(251,191,36,0.32)' }} />
              50–79%
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-sm inline-block" style={{ background: 'rgba(239,68,68,0.18)', border: '1px solid rgba(239,68,68,0.32)' }} />
              &lt;50%
            </span>
          </div>
          <div className="grid grid-cols-7 gap-1 mb-1">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => (
              <div key={d} className="text-[10px] text-[#8B949E] text-center font-semibold">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: (new Date(calendarDays[0]).getDay() + 6) % 7 }).map((_, i) => (
              <div key={`pad-${i}`} style={{ height: `${heatmapCellHeight}px` }} />
            ))}
            {calendarDays.map(d => {
              const dateStr = format(d, 'yyyy-MM-dd');
              const isToday = dateStr === todayStr;
              const isFuture = dateStr > todayStr;
              const { pct, total } = calendarDayAdherence[dateStr] ?? { pct: -1, total: 0 };
              return (
                <div
                  key={dateStr}
                  style={{
                    height: `${heatmapCellHeight}px`,
                    background: heatmapCellBg(pct, total, isFuture),
                    borderColor: isToday ? 'rgba(255,255,255,0.4)' : heatmapCellBorder(pct, total, isFuture),
                    borderWidth: 1,
                    borderStyle: 'solid',
                    borderRadius: 5,
                  }}
                  className="flex items-center justify-center"
                >
                  <span className={`text-[10px] leading-none ${isToday ? 'text-[#F0F6FC] font-bold' : 'text-[#8B949E]'}`}>
                    {format(d, 'd')}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="flex items-center justify-between mt-2 text-[11px] text-[#8B949E]">
            <span>{format(calendarDays[0], 'MMM d')}</span>
            <span>{format(calendarDays[calendarDays.length - 1], 'MMM d')}</span>
          </div>
        </div>

        {/* ── 6. PER-PROTOCOL BREAKDOWN (sorted: weakest first) ── */}
        {activeProtocols.length > 0 && (
          <div className="bg-[#161B22] border border-[rgba(255,255,255,0.08)] rounded-2xl p-4">
            <div className="text-xs font-bold text-[#8B949E] uppercase tracking-widest mb-4">By Protocol</div>
            {sortedActiveProtocols.map(ap => {
              const protocolStats = protocolBreakdownStats[ap.id] ?? { total: 0, taken: 0 };
              const pct = protocolStats.total ? Math.round(protocolStats.taken / protocolStats.total * 100) : 0;
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
                  <div className="text-[11px] text-[#8B949E] mt-1">{protocolStats.taken} of {protocolStats.total} doses · {ap.status}</div>
                </div>
              );
            })}
          </div>
        )}

        {stats.total === 0 && (
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
