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

export default function ProgressPage() {
  const { scheduledDoses, activeProtocols, getStreak } = useStore();
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

  const stats = useMemo(() => {
    const metricDoses = scheduledDoses.filter(d => d.status !== 'snoozed');
    const total = metricDoses.length;
    const taken = metricDoses.filter(d => d.status === 'taken').length;
    const skipped = metricDoses.filter(d => d.status === 'skipped').length;
    const overdue = metricDoses.filter(d => d.status === 'overdue').length;
    const pct = total ? Math.round(taken / total * 100) : 0;
    return { total, taken, skipped, overdue, pct };
  }, [scheduledDoses]);

  const protocolTracks = useMemo(() => {
    const withWeight = activeProtocols
      .map((ap, idx) => {
        const total = scheduledDoses.filter(d => d.activeProtocolId === ap.id).length;
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
  }, [activeProtocols, scheduledDoses]);

  const dayProtocolStats = useMemo(() => {
    const map = new Map<string, Map<string, { total: number; taken: number }>>();
    for (const dose of scheduledDoses) {
      if (dose.status === 'snoozed') continue;
      const dayMap = map.get(dose.scheduledDate) ?? new Map<string, { total: number; taken: number }>();
      const current = dayMap.get(dose.activeProtocolId) ?? { total: 0, taken: 0 };
      current.total += 1;
      if (dose.status === 'taken') current.taken += 1;
      dayMap.set(dose.activeProtocolId, current);
      map.set(dose.scheduledDate, dayMap);
    }
    return map;
  }, [scheduledDoses]);

  const buildRingsForDate = (dateStr: string): RingDatum[] => {
    const dayMap = dayProtocolStats.get(dateStr);
    const isFuture = dateStr > todayStr;
    return protocolTracks.map(track => {
      const stat = dayMap?.get(track.id);
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

  const streak = getStreak();

  const activeCount = activeProtocols.filter(ap => ap.status === 'active').length;
  const todayStatus = useMemo(() => {
    const todayDoses = scheduledDoses.filter(d => d.scheduledDate === todayStr && d.status !== 'snoozed');
    return {
      taken: todayDoses.filter(d => d.status === 'taken').length,
      skipped: todayDoses.filter(d => d.status === 'skipped').length,
      remaining: todayDoses.filter(d => d.status !== 'taken' && d.status !== 'skipped').length,
    };
  }, [scheduledDoses, todayStr]);
  const weeklyRingSize = isMobile ? 30 : 38;
  const weeklyRingStroke = isMobile ? 3 : 3.5;
  const calendarRingSize = isMobile ? (calendarRange === 90 ? 20 : calendarRange === 60 ? 24 : 28) : (calendarRange === 90 ? 24 : calendarRange === 60 ? 28 : 34);
  const calendarRingStroke = isMobile ? 2.4 : 3;
  const cellHeight = isMobile ? (calendarRange === 90 ? 40 : 46) : 56;

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

        {/* Weekly protocol rings */}
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
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-3 text-[11px] text-[#8B949E]">
            {protocolTracks.map(track => (
              <span key={track.id} className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full inline-block" style={{ background: track.color }} />
                {track.name}
              </span>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-[11px] text-[#8B949E]">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#10B981] inline-block" /> Taken {todayStatus.taken}</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#F59E0B] inline-block" /> Remaining {todayStatus.remaining}</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#8B949E] inline-block" /> Skipped {todayStatus.skipped}</span>
          </div>
        </div>

        {/* 30-day calendar with protocol rings */}
        <div className="bg-[#161B22] border border-[rgba(255,255,255,0.08)] rounded-2xl p-4 mb-4">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="text-xs font-bold text-[#8B949E] uppercase tracking-widest">Calendar</div>
            <div className="flex items-center gap-1">
              {[30, 60, 90].map(value => (
                <button
                  key={value}
                  onClick={() => setCalendarRange(value as 30 | 60 | 90)}
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
          <div className="grid grid-cols-7 gap-1 mb-2">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => (
              <div key={d} className="text-[10px] text-[#8B949E] text-center font-semibold">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-2">
            {Array.from({ length: (new Date(calendarDays[0]).getDay() + 6) % 7 }).map((_, i) => (
              <div key={`pad-${i}`} style={{ height: `${cellHeight}px` }} />
            ))}
            {calendarDays.map(d => {
              const dateStr = format(d, 'yyyy-MM-dd');
              const isToday = dateStr === todayStr;
              return (
                <div key={dateStr} style={{ height: `${cellHeight}px` }} className="flex flex-col items-center justify-center gap-0.5">
                  <div className={isToday ? 'ring-1 ring-white/35 rounded-full' : ''}>
                    <DayRings rings={buildRingsForDate(dateStr)} size={calendarRingSize} stroke={calendarRingStroke} />
                  </div>
                  <span className={`text-[10px] ${isToday ? 'text-[#F0F6FC] font-bold' : 'text-[#8B949E]'}`}>
                    {format(d, 'd')}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="flex items-center justify-between mt-3 text-[11px] text-[#8B949E]">
            <span>{format(calendarDays[0], 'MMM d')}</span>
            <span>{format(calendarDays[calendarDays.length - 1], 'MMM d')}</span>
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
