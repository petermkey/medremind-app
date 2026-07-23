'use client';
import { useEffect, useMemo, useState } from 'react';
import { addDays, eachDayOfInterval, format, subDays } from 'date-fns';
import { useRouter, useSearchParams } from 'next/navigation';
import { OuraTab } from '@/components/app/oura/OuraTab';
import { NutrientBalanceCard } from '@/components/app/nutrientBalance/NutrientBalanceCard';
import { WeeklyReviewSection } from '@/components/app/WeeklyReviewSection';
import { Button } from '@/components/ui/Button';
import { useStore } from '@/lib/store/store';

type MedicationStatus = {
  counts?: {
    mapItems: number;
    rules: number;
    clinicianReviewFlags: number;
    dailyExposures: number;
  };
  lastRun?: {
    status?: string;
    updatedAt?: string | null;
    lastError?: string | null;
  } | null;
  error?: string;
};

type Consent = {
  enabled: boolean;
  includesMedicationPatterns: boolean;
  includesHealthData: boolean;
  acknowledgedNoMedChanges: boolean;
};

type CorrelationCard = {
  title: string;
  body: string;
  strength: string;
  direction: string;
  recommendationKind: string;
  r: number;
  n: number;
  generatedAt: string;
};

type CorrelationResponse = {
  consent: Consent;
  cards: CorrelationCard[];
  error?: string;
};

const DEFAULT_CONSENT: Consent = {
  enabled: false,
  includesMedicationPatterns: false,
  includesHealthData: false,
  acknowledgedNoMedChanges: false,
};

function pctToColor(pct: number) {
  if (pct === 0) return '#191d22';
  if (pct < 50) return '#c96a5a';
  if (pct < 80) return '#cf8148';
  return '#8fae74';
}

const RING_COLORS = ['#d9a53f', '#8fae74', '#cf8148', '#c97c98', '#a292c9', '#c96a5a'];

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
    color: '#9b978f',
    borderColor: 'rgba(162,146,201,0.12)',
    bgColor: 'rgba(162,146,201,0.05)',
  };
  if (pct >= 80) return {
    label: 'On track',
    color: '#8fae74',
    borderColor: 'rgba(143,174,116,0.22)',
    bgColor: 'rgba(143,174,116,0.08)',
  };
  if (pct >= 50) return {
    label: 'Needs attention',
    color: '#cf8148',
    borderColor: 'rgba(207,129,72,0.22)',
    bgColor: 'rgba(207,129,72,0.08)',
  };
  return {
    label: 'Off track',
    color: '#c96a5a',
    borderColor: 'rgba(201,106,90,0.22)',
    bgColor: 'rgba(201,106,90,0.08)',
  };
}

function heatmapCellBg(pct: number, total: number, isFuture: boolean): string {
  if (isFuture || total === 0) return 'transparent';
  if (pct >= 80) return 'rgba(143,174,116,0.18)';
  if (pct >= 50) return 'rgba(207,129,72,0.18)';
  return 'rgba(201,106,90,0.18)';
}

function heatmapCellBorder(pct: number, total: number, isFuture: boolean): string {
  if (isFuture || total === 0) return 'rgba(255,255,255,0.04)';
  if (pct >= 80) return 'rgba(143,174,116,0.32)';
  if (pct >= 50) return 'rgba(207,129,72,0.32)';
  return 'rgba(201,106,90,0.32)';
}

export default function ProgressPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
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
  const [medicationStatus, setMedicationStatus] = useState<MedicationStatus | null>(null);
  const [correlations, setCorrelations] = useState<CorrelationResponse>({ consent: DEFAULT_CONSENT, cards: [] });
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  const [refreshingMedication, setRefreshingMedication] = useState(false);
  const [refreshingCorrelations, setRefreshingCorrelations] = useState(false);
  const [analyticsMessage, setAnalyticsMessage] = useState('');
  const activeTab = searchParams.get('tab') === 'oura' ? 'oura' : 'correlations';

  const today = new Date();
  const todayStr = format(today, 'yyyy-MM-dd');

  function setActiveTab(tab: 'correlations' | 'oura') {
    const params = new URLSearchParams(searchParams.toString());
    if (tab === 'oura') {
      params.set('tab', 'oura');
    } else {
      params.delete('tab');
    }
    const query = params.toString();
    router.replace(query ? `/app/progress?${query}` : '/app/progress', { scroll: false });
  }

  useEffect(() => {
    const update = () => setIsMobile(window.innerWidth < 640);
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      fetch('/api/medication-knowledge/status')
        .then((response) => response.json())
        .catch(() => ({ error: 'Medication knowledge unavailable.' })),
      fetch('/api/insights/correlations')
        .then((response) => response.json())
        .catch(() => ({ consent: DEFAULT_CONSENT, cards: [], error: 'Progress analytics unavailable.' })),
    ]).then(([medicationData, correlationData]) => {
      if (cancelled) return;
      setMedicationStatus(medicationData);
      setCorrelations({
        consent: correlationData.consent ?? DEFAULT_CONSENT,
        cards: correlationData.cards ?? [],
        error: correlationData.error,
      });
    }).finally(() => {
      if (!cancelled) setAnalyticsLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const consentReady = useMemo(() => (
    correlations.consent.enabled
    && correlations.consent.includesMedicationPatterns
    && correlations.consent.includesHealthData
    && correlations.consent.acknowledgedNoMedChanges
  ), [correlations.consent]);

  async function saveConsent(nextConsent: Consent) {
    setAnalyticsMessage('');
    const response = await fetch('/api/insights/correlations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ consent: nextConsent, refresh: false }),
    });
    const data = await response.json();
    setCorrelations({
      consent: data.consent ?? nextConsent,
      cards: data.cards ?? [],
      error: response.ok ? undefined : data.error,
    });
    if (!response.ok) setAnalyticsMessage(data.error ?? 'Consent update failed.');
  }

  async function refreshMedicationKnowledge() {
    setRefreshingMedication(true);
    setAnalyticsMessage('');
    try {
      const response = await fetch('/api/medication-knowledge/refresh', { method: 'POST' });
      const data = await response.json();
      setMedicationStatus((current) => ({
        ...current,
        counts: {
          mapItems: data.counts?.mapItems ?? current?.counts?.mapItems ?? 0,
          rules: data.counts?.rules ?? current?.counts?.rules ?? 0,
          clinicianReviewFlags: current?.counts?.clinicianReviewFlags ?? 0,
          dailyExposures: data.counts?.dailyExposures ?? current?.counts?.dailyExposures ?? 0,
        },
        lastRun: data.lastRun ?? current?.lastRun ?? null,
        error: response.ok ? undefined : data.error,
      }));
      setAnalyticsMessage(response.ok ? 'Medication context refreshed.' : data.error ?? 'Medication context refresh failed.');
    } finally {
      setRefreshingMedication(false);
    }
  }

  async function refreshCorrelations() {
    setRefreshingCorrelations(true);
    setAnalyticsMessage('');
    try {
      const response = await fetch('/api/insights/correlations', { method: 'POST' });
      const data = await response.json();
      setCorrelations({
        consent: data.consent ?? correlations.consent,
        cards: data.cards ?? [],
        error: response.ok ? undefined : data.error,
      });
      setAnalyticsMessage(response.ok ? 'Progress analytics refreshed.' : data.error ?? 'Progress analytics refresh failed.');
    } finally {
      setRefreshingCorrelations(false);
    }
  }

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
          seedColor === 'blue' ? '#d9a53f' :
          seedColor === 'green' ? '#8fae74' :
          seedColor === 'yellow' ? '#cf8148' :
          seedColor === 'pink' ? '#c97c98' :
          seedColor === 'purple' ? '#a292c9' :
          seedColor === 'red' ? '#c96a5a' :
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
    return [...activeProtocols].filter(ap => ap.status === 'active').sort((a, b) => {
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
        <h1 className="text-xl font-extrabold text-[#e8e6e1]">Progress</h1>
        <div className="mt-3 grid grid-cols-2 rounded-xl bg-[#0e1013] p-1">
          {([
            ['correlations', 'Correlations'],
            ['oura', 'Oura'],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setActiveTab(value)}
              className={[
                'rounded-lg px-3 py-2 text-sm font-bold transition-colors',
                activeTab === value ? 'bg-[#d9a53f] text-white' : 'text-[#9b978f] hover:text-[#e8e6e1]',
              ].join(' ')}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-6">
        {activeTab === 'oura' ? <OuraTab /> : (
        <>

        {/* ── 0. WEEKLY AI REVIEW (W4-B) ── */}
        <WeeklyReviewSection />

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
          <div className="text-[11px] text-[#9b978f]">
            {weekStats.total > 0
              ? `${weekStats.taken} of ${weekStats.total} doses taken this week`
              : 'No dose data for the last 7 days'}
          </div>
          {trendDelta !== null && (
            <div
              className="text-[11px] mt-1 font-semibold"
              style={{ color: trendDelta > 3 ? '#8fae74' : trendDelta < -3 ? '#c96a5a' : '#9b978f' }}
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
          <div className="text-[10px] font-bold text-[#9b978f] uppercase tracking-widest mb-1.5">Today</div>
          <div className="flex gap-2">
            <div className="flex-1 bg-[#14171b] border border-[rgba(255,255,255,0.06)] rounded-xl px-3 py-2.5 flex items-center gap-1.5 min-w-0">
              <span className="text-[11px] font-bold text-[#8fae74] flex-shrink-0">✓ {todayStatus.taken}</span>
              <span className="text-[10px] text-[#9b978f] truncate">taken</span>
            </div>
            <div className="flex-1 bg-[#14171b] border border-[rgba(255,255,255,0.06)] rounded-xl px-3 py-2.5 flex items-center gap-1.5 min-w-0">
              <span className="text-[11px] font-bold text-[#d9a53f] flex-shrink-0">→ {todayStatus.remaining}</span>
              <span className="text-[10px] text-[#9b978f] truncate">left</span>
            </div>
            <div className="flex-1 bg-[#14171b] border border-[rgba(255,255,255,0.06)] rounded-xl px-3 py-2.5 flex items-center gap-1.5 min-w-0">
              <span className="text-[11px] font-bold text-[#9b978f] flex-shrink-0">— {todayStatus.skipped}</span>
              <span className="text-[10px] text-[#9b978f] truncate">skipped</span>
            </div>
          </div>
          </div>
        )}

        {/* ── 3. SUMMARY METRICS (time-scoped labels) ── */}
        <div className="grid grid-cols-2 gap-3 mb-5">
          {[
            { label: 'Adherence', value: `${stats.pct}%`,    color: '#d9a53f', sub: `last ${calendarRange}d` },
            { label: 'Streak',    value: `${streak}`,         color: '#8fae74', sub: 'days in a row' },
            { label: 'Active',    value: `${activeCount}`,    color: '#a292c9', sub: 'protocols' },
            { label: 'Taken',     value: `${stats.taken}`,    color: '#8fae74', sub: `of ${stats.total} (${calendarRange}d)` },
          ].map(({ label, value, color, sub }) => (
            <div key={label} className="bg-[#14171b] border border-[rgba(255,255,255,0.08)] rounded-2xl p-4">
              <div className="text-2xl font-extrabold" style={{ color }}>{value}</div>
              <div className="text-xs font-semibold text-[#e8e6e1] mt-0.5">{label}</div>
              <div className="text-[11px] text-[#9b978f]">{sub}</div>
            </div>
          ))}
        </div>

        {/* ── 4. HEALTH AND MEDICATION PATTERNS ── */}
        <div className="bg-[#14171b] border border-[rgba(255,255,255,0.08)] rounded-2xl p-4 mb-4">
          <div className="flex items-start justify-between gap-3 mb-4">
            <div>
              <div className="text-xs font-bold text-[#9b978f] uppercase tracking-widest">Health & Medication Patterns</div>
              <div className="mt-1 text-xs leading-relaxed text-[#9b978f]">
                Oura connection and health sync are managed in Settings.
              </div>
            </div>
            <a href="/app/settings" className="text-xs font-semibold text-[#d9a53f] hover:underline">
              Settings
            </a>
          </div>

          {analyticsLoading ? (
            <p className="text-sm text-[#9b978f]">Loading analytics...</p>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between gap-3 rounded-xl bg-[#0e1013] p-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-[#e8e6e1]">
                    {medicationStatus?.counts?.mapItems ?? 0} medication map item(s)
                  </div>
                  <div className="mt-1 text-xs text-[#9b978f]">
                    {medicationStatus?.counts?.rules ?? 0} rule card(s), {medicationStatus?.counts?.clinicianReviewFlags ?? 0} clinician-review flag(s)
                  </div>
                </div>
                <Button size="sm" variant="secondary" onClick={refreshMedicationKnowledge} loading={refreshingMedication}>
                  Refresh
                </Button>
              </div>

              <div className="flex flex-col gap-3 rounded-xl bg-[#0e1013] p-3">
                <ConsentToggle
                  label="Medication pattern analysis"
                  checked={correlations.consent.enabled && correlations.consent.includesMedicationPatterns}
                  onChange={(checked) => saveConsent({
                    ...correlations.consent,
                    enabled: checked || correlations.consent.includesHealthData,
                    includesMedicationPatterns: checked,
                  })}
                />
                <ConsentToggle
                  label="Health-data analysis"
                  checked={correlations.consent.enabled && correlations.consent.includesHealthData}
                  onChange={(checked) => saveConsent({
                    ...correlations.consent,
                    enabled: checked || correlations.consent.includesMedicationPatterns,
                    includesHealthData: checked,
                  })}
                />
                <ConsentToggle
                  label="I understand these patterns support clinician review and do not change medication instructions."
                  checked={correlations.consent.acknowledgedNoMedChanges}
                  onChange={(checked) => saveConsent({
                    ...correlations.consent,
                    enabled: checked || correlations.consent.enabled,
                    acknowledgedNoMedChanges: checked,
                  })}
                />
                <Button size="sm" onClick={refreshCorrelations} loading={refreshingCorrelations} disabled={!consentReady}>
                  Refresh patterns
                </Button>
              </div>

              {analyticsMessage && <p className="text-xs text-[#9b978f]">{analyticsMessage}</p>}
              {medicationStatus?.error && <p className="text-xs text-[#e2a89d]">{medicationStatus.error}</p>}
              {correlations.error && <p className="text-xs text-[#e2a89d]">{correlations.error}</p>}

              {correlations.cards.length === 0 ? (
                <p className="text-sm leading-relaxed text-[#9b978f]">
                  No pattern cards yet. Enable consent and refresh after medication context, food, hydration, and health summaries are available.
                </p>
              ) : correlations.cards.map((card) => (
                <article key={`${card.title}-${card.generatedAt}`} className="rounded-xl border border-[rgba(255,255,255,0.08)] bg-[#0e1013] p-4">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <h2 className="text-sm font-bold text-[#e8e6e1]">{card.title}</h2>
                    <span className="rounded-full bg-[rgba(217,165,63,0.12)] px-2 py-1 text-[10px] font-bold uppercase text-[#93C5FD]">
                      {card.strength}
                    </span>
                  </div>
                  <p className="text-sm leading-relaxed text-[#c4c0b8]">{card.body}</p>
                  <p className="mt-3 text-xs text-[#9b978f]">
                    Direction: {card.direction} · r {card.r.toFixed(2)} · paired days {card.n}
                  </p>
                </article>
              ))}
            </div>
          )}
        </div>

        <NutrientBalanceCard />

        {/* ── 5. LAST 7 DAYS (weekly rings — unchanged) ── */}
        <div className="bg-[#14171b] border border-[rgba(255,255,255,0.08)] rounded-2xl p-4 mb-4">
          <div className="text-xs font-bold text-[#9b978f] uppercase tracking-widest mb-4">Last 7 Days</div>
          <div className="grid grid-cols-7 gap-2">
            {weeklyData.map(({ date, label, day }) => (
              <div key={date} className="flex flex-col items-center gap-1.5">
                <DayRings rings={buildRingsForDate(date)} size={weeklyRingSize} stroke={weeklyRingStroke} />
                <span className="text-[10px] text-[#9b978f]">{label}</span>
                <span className="text-[10px] text-[#e8e6e1] font-semibold">{day}</span>
              </div>
            ))}
          </div>
          {protocolTracks.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-3 text-[11px] text-[#9b978f]">
              {protocolTracks.map(track => (
                <span key={track.id} className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full inline-block" style={{ background: track.color }} />
                  {track.name}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* ── 6. MONTHLY PATTERN (heatmap cells) ── */}
        <div className="bg-[#14171b] border border-[rgba(255,255,255,0.08)] rounded-2xl p-4 mb-4">
          <div className="flex items-center justify-between gap-3 mb-2">
            <div className="text-xs font-bold text-[#9b978f] uppercase tracking-widest">Monthly Pattern</div>
            <div className="flex items-center gap-1">
              {([30, 60, 90] as const).map(value => (
                <button
                  key={value}
                  onClick={() => setCalendarRange(value)}
                  className={[
                    'px-2 py-1 rounded-lg text-[10px] font-semibold transition-colors',
                    calendarRange === value ? 'bg-[#d9a53f] text-white' : 'bg-[#191d22] text-[#9b978f] hover:text-[#e8e6e1]',
                  ].join(' ')}
                >
                  {value}d
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-3 mb-3 text-[10px] text-[#9b978f]">
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-sm inline-block" style={{ background: 'rgba(143,174,116,0.18)', border: '1px solid rgba(143,174,116,0.32)' }} />
              ≥80%
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-sm inline-block" style={{ background: 'rgba(207,129,72,0.18)', border: '1px solid rgba(207,129,72,0.32)' }} />
              50–79%
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-sm inline-block" style={{ background: 'rgba(201,106,90,0.18)', border: '1px solid rgba(201,106,90,0.32)' }} />
              &lt;50%
            </span>
          </div>
          <div className="grid grid-cols-7 gap-1 mb-1">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => (
              <div key={d} className="text-[10px] text-[#9b978f] text-center font-semibold">{d}</div>
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
                  <span className={`text-[10px] leading-none ${isToday ? 'text-[#e8e6e1] font-bold' : 'text-[#9b978f]'}`}>
                    {format(d, 'd')}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="flex items-center justify-between mt-2 text-[11px] text-[#9b978f]">
            <span>{format(calendarDays[0], 'MMM d')}</span>
            <span>{format(calendarDays[calendarDays.length - 1], 'MMM d')}</span>
          </div>
        </div>

        {/* ── 7. PER-PROTOCOL BREAKDOWN (sorted: weakest first) ── */}
        {sortedActiveProtocols.length > 0 && (
          <div className="bg-[#14171b] border border-[rgba(255,255,255,0.08)] rounded-2xl p-4">
            <div className="text-xs font-bold text-[#9b978f] uppercase tracking-widest mb-4">By Protocol</div>
            {sortedActiveProtocols.map(ap => {
              const protocolStats = protocolBreakdownStats[ap.id] ?? { total: 0, taken: 0 };
              const pct = protocolStats.total ? Math.round(protocolStats.taken / protocolStats.total * 100) : 0;
              const barColor = pctToColor(pct);
              return (
                <div key={ap.id} className="mb-4 last:mb-0">
                  <div className="flex justify-between mb-1.5">
                    <span className="text-sm font-semibold text-[#e8e6e1]">{ap.protocol.name}</span>
                    <span className="text-sm font-bold" style={{ color: barColor }}>{pct}%</span>
                  </div>
                  <div className="h-2 bg-[#191d22] rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: barColor }} />
                  </div>
                  <div className="text-[11px] text-[#9b978f] mt-1">{protocolStats.taken} of {protocolStats.total} doses · {ap.status}</div>
                </div>
              );
            })}
          </div>
        )}

        {stats.total === 0 && (
          <div className="text-center py-10">
            <div className="text-4xl mb-3">📊</div>
            <div className="text-sm font-bold text-[#e8e6e1] mb-1">No data yet</div>
            <div className="text-xs text-[#9b978f]">Activate a protocol to start tracking your adherence.</div>
          </div>
        )}
        </>
        )}
      </div>
    </div>
  );
}

function ConsentToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex items-center justify-between gap-3 text-left"
    >
      <span className="text-sm font-semibold leading-relaxed text-[#e8e6e1]">{label}</span>
      <span className={`relative h-6 w-12 flex-shrink-0 rounded-full transition-colors ${checked ? 'bg-[#d9a53f]' : 'bg-[#191d22]'}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${checked ? 'left-6' : 'left-0.5'}`} />
      </span>
    </button>
  );
}
