'use client';
import { useMemo, useState, useEffect } from 'react';
import { addDays, addMinutes, format, parseISO } from 'date-fns';
import { useStore } from '@/lib/store/store';
import { WeekStrip } from '@/components/app/WeekStrip';
import { MedCard } from '@/components/app/MedCard';
import { AddDoseSheet } from '@/components/app/AddDoseSheet';
import { useToast } from '@/components/ui/Toast';
import Link from 'next/link';
import type { ScheduledDose } from '@/types';

function fmtTime(t: string) {
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function SchedulePage() {
  const {
    profile,
    activeProtocols,
    getDaySchedule,
    getVisibleDoseDates,
    takeDose,
    skipDose,
    snoozeDose,
    scheduledDoses,
  } = useStore();
  const { show } = useToast();

  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const [selectedDate, setSelectedDate] = useState(todayStr);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [clock, setClock] = useState('');
  const [snoozeTargetDose, setSnoozeTargetDose] = useState<ScheduledDose | null>(null);

  useEffect(() => {
    const update = () => setClock(format(new Date(), 'HH:mm'));
    update();
    const t = setInterval(update, 10000);
    return () => clearInterval(t);
  }, []);

  const doses = useMemo(() => getDaySchedule(selectedDate), [selectedDate, scheduledDoses]);
  const visibleDoses = useMemo(
    () => doses.filter(d => d.status !== 'skipped'),
    [doses],
  );

  // Dates that have at least one dose (for week strip dots)
  const doseDateSet = useMemo(() => {
    return new Set<string>(getVisibleDoseDates());
  }, [scheduledDoses, activeProtocols, getVisibleDoseDates]);

  // Group by time block
  const grouped = useMemo(() => {
    const blocks: { label: string; doses: typeof visibleDoses }[] = [];
    const seen: Record<string, number> = {};
    for (const dose of visibleDoses) {
      const [h] = dose.scheduledTime.split(':').map(Number);
      const label = h < 12 ? `Morning · ${fmtTime(dose.scheduledTime)}` :
                    h < 17 ? `Afternoon · ${fmtTime(dose.scheduledTime)}` :
                              `Evening · ${fmtTime(dose.scheduledTime)}`;
      if (!(label in seen)) { seen[label] = blocks.length; blocks.push({ label, doses: [] }); }
      blocks[seen[label]].doses.push(dose);
    }
    return blocks;
  }, [visibleDoses]);

  const taken = doses.filter(d => d.status === 'taken').length;
  const total = doses.length;
  const pct = total ? Math.round((taken / total) * 100) : 0;

  const nextDose = doses
    .filter(d => d.status === 'pending' || d.status === 'snoozed' || (d.status as string) === 'upcoming')
    .sort((a, b) => a.scheduledTime.localeCompare(b.scheduledTime))[0];

  function getSnoozeUntil(dose: ScheduledDose, option: '15m' | '1h' | 'evening' | 'tomorrow') {
    const now = new Date();
    if (option === '15m') return addMinutes(now, 15);
    if (option === '1h') return addMinutes(now, 60);
    if (option === 'evening') {
      const evening = new Date(now);
      evening.setHours(19, 0, 0, 0);
      if (evening.getTime() <= now.getTime()) {
        evening.setHours(21, 0, 0, 0);
      }
      return evening.getTime() > now.getTime() ? evening : addMinutes(now, 15);
    }
    const [hours, minutes] = dose.scheduledTime.split(':').map(Number);
    const tomorrow = addDays(now, 1);
    tomorrow.setHours(hours, minutes, 0, 0);
    return tomorrow;
  }

  function applySnooze(option: '15m' | '1h' | 'evening' | 'tomorrow') {
    if (!snoozeTargetDose) return;
    const until = getSnoozeUntil(snoozeTargetDose, option);
    snoozeDose(snoozeTargetDose.id, { until: until.toISOString() });
    const label =
      option === '15m'
        ? '15 minutes'
        : option === '1h'
          ? '1 hour'
          : option === 'evening'
            ? `this evening (${fmtTime(format(until, 'HH:mm'))})`
            : `tomorrow (${fmtTime(format(until, 'HH:mm'))})`;
    show(`⏰ Snoozed to ${label}`, 'warning');
    setSnoozeTargetDose(null);
  }

  return (
    <div className="flex flex-col h-full">
      {/* Status bar */}
      <div className="flex justify-between items-center px-5 pt-3 pb-1.5 flex-shrink-0">
        <span className="text-sm font-bold text-[#F0F6FC]">{clock}</span>
        <div className="flex gap-1.5 text-xs text-[#8B949E]">
          <span>●●●</span><span>WiFi</span><span>🔋</span>
        </div>
      </div>

      {/* Header */}
      <div className="px-5 pb-4 flex-shrink-0">
        <div className="flex justify-between items-center mb-3">
          <div>
            <div className="text-xs text-[#8B949E] font-medium">{greeting()} ☀️</div>
            <div className="text-xl font-extrabold text-[#F0F6FC]">{profile?.name}</div>
          </div>
          <Link href="/app/settings" className="w-9 h-9 rounded-full bg-gradient-to-br from-[#3B82F6] to-[#8B5CF6] flex items-center justify-center text-sm font-bold text-white">
            {profile?.name?.charAt(0).toUpperCase()}
          </Link>
        </div>

        {/* Progress */}
        <div className="mb-4">
          <div className="flex justify-between text-xs text-[#8B949E] mb-1.5">
            <span>Today&apos;s progress</span>
            <span className="text-[#10B981] font-semibold">{taken} of {total} taken</span>
          </div>
          <div className="h-1.5 bg-[#1C2333] rounded-full overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#3B82F6] to-[#10B981] transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>

        <WeekStrip selectedDate={selectedDate} onSelectDate={setSelectedDate} doseDateSet={doseDateSet} />
      </div>

      {/* Scroll area */}
      <div className="flex-1 overflow-y-auto px-5 pb-4">

        {/* Next dose banner */}
        {nextDose && (
          <div className="bg-gradient-to-r from-[rgba(59,130,246,0.12)] to-[rgba(139,92,246,0.08)] border border-[rgba(59,130,246,0.2)] rounded-2xl p-4 mb-5 flex items-center gap-3">
            <span className="text-2xl">⏰</span>
            <div className="flex-1">
              <div className="text-sm font-bold text-[#F0F6FC]">Next dose</div>
              <div className="text-xs text-[#8B949E] mt-0.5">
                {nextDose.protocolItem.name} {nextDose.protocolItem.doseAmount ?? ''}{nextDose.protocolItem.doseUnit ?? ''}
              </div>
            </div>
            <div className="text-sm font-bold text-[#3B82F6]">{fmtTime(nextDose.scheduledTime)}</div>
          </div>
        )}

        {/* Empty state */}
        {total === 0 && (
          <div className="text-center py-16 fade-in">
            <div className="text-5xl mb-4">💊</div>
            <div className="text-base font-bold text-[#F0F6FC] mb-2">No doses scheduled</div>
            <div className="text-sm text-[#8B949E] mb-6">Activate a protocol or add a medication to get started.</div>
            <div className="flex gap-3 justify-center">
              <Link href="/app/protocols" className="text-sm font-semibold text-[#3B82F6] border border-[rgba(59,130,246,0.3)] px-4 py-2.5 rounded-xl hover:bg-[rgba(59,130,246,0.1)]">
                Browse Protocols
              </Link>
              <button onClick={() => setSheetOpen(true)} className="text-sm font-semibold text-white bg-[#3B82F6] px-4 py-2.5 rounded-xl hover:bg-[#2563EB]">
                + Add Manually
              </button>
            </div>
          </div>
        )}

        {/* Grouped doses */}
        {grouped.map(({ label, doses: group }) => (
          <div key={label} className="mb-6">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-[11px] font-bold text-[#8B949E] uppercase tracking-widest">{label}</span>
              <div className="flex-1 h-px bg-[rgba(255,255,255,0.05)]" />
            </div>
            {group.map(dose => (
              <MedCard
                key={dose.id}
                dose={dose}
                onTake={() => { takeDose(dose.id); show(`✓ ${dose.protocolItem.name} taken`); }}
                onSkip={() => { skipDose(dose.id); show(`Skipped ${dose.protocolItem.name}`, 'warning'); }}
                onSnooze={() => { setSnoozeTargetDose(dose); }}
              />
            ))}
          </div>
        ))}
      </div>

      {/* FAB */}
      <button
        onClick={() => setSheetOpen(true)}
        className="absolute bottom-24 right-5 w-12 h-12 bg-[#3B82F6] hover:bg-[#2563EB] rounded-[16px] shadow-[0_4px_20px_rgba(59,130,246,0.5)] flex items-center justify-center text-2xl text-white transition-all duration-200 z-10"
      >
        ＋
      </button>

      <AddDoseSheet open={sheetOpen} onClose={() => setSheetOpen(false)} />
      {snoozeTargetDose && (
        <div className="fixed inset-0 z-40 bg-black/50 flex items-end">
          <div className="w-full rounded-t-2xl bg-[#0F172A] border-t border-[rgba(255,255,255,0.08)] p-4 pb-6">
            <div className="text-sm font-bold text-[#F0F6FC] mb-1">Snooze dose</div>
            <div className="text-xs text-[#8B949E] mb-3">
              {snoozeTargetDose.protocolItem.name}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => applySnooze('15m')} className="bg-[#1C2333] border border-[rgba(255,255,255,0.08)] rounded-xl py-3 text-sm text-[#F0F6FC] font-semibold">15 minutes</button>
              <button onClick={() => applySnooze('1h')} className="bg-[#1C2333] border border-[rgba(255,255,255,0.08)] rounded-xl py-3 text-sm text-[#F0F6FC] font-semibold">1 hour</button>
              <button onClick={() => applySnooze('evening')} className="bg-[#1C2333] border border-[rgba(255,255,255,0.08)] rounded-xl py-3 text-sm text-[#F0F6FC] font-semibold">This evening</button>
              <button onClick={() => applySnooze('tomorrow')} className="bg-[#1C2333] border border-[rgba(255,255,255,0.08)] rounded-xl py-3 text-sm text-[#F0F6FC] font-semibold">Tomorrow</button>
            </div>
            <button onClick={() => setSnoozeTargetDose(null)} className="w-full mt-2 rounded-xl py-3 text-sm font-semibold text-[#8B949E]">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
