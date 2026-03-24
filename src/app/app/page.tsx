'use client';
import { useMemo, useState, useEffect } from 'react';
import { addDays, addMinutes, format, parseISO } from 'date-fns';
import { useStore } from '@/lib/store/store';
import { WeekStrip } from '@/components/app/WeekStrip';
import { MedCard } from '@/components/app/MedCard';
import { AddDoseSheet } from '@/components/app/AddDoseSheet';
import { useToast } from '@/components/ui/Toast';
import Link from 'next/link';
import type { PlannedOccurrence } from '@/types';

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

function currentDateForTimezone(timezone?: string) {
  const resolvedTimezone = timezone && timezone.trim().length > 0
    ? timezone
    : Intl.DateTimeFormat().resolvedOptions().timeZone;
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: resolvedTimezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date());
    const map = new Map(parts.map(p => [p.type, p.value]));
    const date = `${map.get('year')}-${map.get('month')}-${map.get('day')}`;
    if (date.length === 10) return date;
  } catch (error) {
    console.warn('[schedule-page-timezone-fallback]', error);
  }
  return format(new Date(), 'yyyy-MM-dd');
}

export default function SchedulePage() {
  const {
    profile,
    selectActionableOccurrences,
    selectHistoryOccurrences,
    selectAppNextDose,
    selectAppSummaryMetrics,
    selectCalendarVisibleDoseDates,
    takeDose,
    skipDose,
    snoozeDose,
    removeDose,
    endProtocolFromToday,
    scheduledDoses,
    doseRecords,
  } = useStore();
  const { show } = useToast();

  const todayStr = useMemo(() => currentDateForTimezone(profile?.timezone), [profile?.timezone]);
  const [selectedDate, setSelectedDate] = useState(todayStr);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [snoozeTargetDose, setSnoozeTargetDose] = useState<PlannedOccurrence | null>(null);
  const [deleteTargetDose, setDeleteTargetDose] = useState<PlannedOccurrence | null>(null);
  const isHistoryDate = selectedDate < todayStr;
  const isFutureDate = selectedDate > todayStr;
  const futureActionMessage = 'This dose can be changed only on its scheduled day or later.';
  const pausedHistoryActionMessage = 'Past doses can be moved only in active protocols. Resume this protocol first.';
  const pausedProtocolActionMessage = 'Protocol is paused. Resume it to change this dose.';


  const actionableDoses = useMemo(
    () => (isHistoryDate ? selectHistoryOccurrences(selectedDate) : selectActionableOccurrences(selectedDate)),
    [selectedDate, isHistoryDate, scheduledDoses, selectHistoryOccurrences, selectActionableOccurrences],
  );

  // Dates that have at least one dose (for week strip dots)
  const doseDateSet = useMemo(() => {
    return new Set<string>(selectCalendarVisibleDoseDates(selectedDate));
  }, [selectedDate, scheduledDoses, selectCalendarVisibleDoseDates]);

  // Group by time block
  const grouped = useMemo(() => {
    const blocks: { label: string; doses: typeof actionableDoses }[] = [];
    const seen: Record<string, number> = {};
    for (const dose of actionableDoses) {
      const [h] = dose.scheduledTime.split(':').map(Number);
      const label = h < 12 ? `Morning · ${fmtTime(dose.scheduledTime)}` :
                    h < 17 ? `Afternoon · ${fmtTime(dose.scheduledTime)}` :
                              `Evening · ${fmtTime(dose.scheduledTime)}`;
      if (!(label in seen)) { seen[label] = blocks.length; blocks.push({ label, doses: [] }); }
      blocks[seen[label]].doses.push(dose);
    }
    return blocks;
  }, [actionableDoses]);

  const { taken, total, pct } = useMemo(
    () => {
      if (!isHistoryDate) return selectAppSummaryMetrics(selectedDate);
      const historyTotal = actionableDoses.length;
      const historyTaken = actionableDoses.filter(d => d.status === 'taken').length;
      const historyPct = historyTotal ? Math.round((historyTaken / historyTotal) * 100) : 0;
      return { taken: historyTaken, total: historyTotal, pct: historyPct };
    },
    [selectedDate, isHistoryDate, scheduledDoses, actionableDoses, selectAppSummaryMetrics],
  );

  const nextDose = useMemo(
    () => (isHistoryDate ? undefined : selectAppNextDose(selectedDate)),
    [selectedDate, isHistoryDate, scheduledDoses, selectAppNextDose],
  );

  // Map doseId → recordedAt for taken records (to display actual intake time)
  const takenAtMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of doseRecords) {
      if (r.action === 'taken') map.set(r.scheduledDoseId, r.recordedAt);
    }
    return map;
  }, [doseRecords]);

  function getSnoozeUntil(dose: PlannedOccurrence, option: '1h' | 'evening' | 'tomorrow' | 'next_week') {
    const now = new Date();
    const isHistoricalDose = dose.scheduledDate < todayStr;
    const intendedTime = dose.protocolItem.times[0] ?? dose.scheduledTime;
    const [intendedHours, intendedMinutes] = intendedTime.split(':').map(Number);

    if (option === '1h') return addMinutes(now, 60);

    if (option === 'evening') {
      const evening = new Date(now);
      evening.setHours(21, 0, 0, 0);
      if (evening <= now) {
        return addDays(evening, 1);
      }
      return evening;
    }

    if (option === 'tomorrow') {
      const target = isHistoricalDose
        ? addDays(parseISO(dose.scheduledDate), 1)
        : addDays(now, 1);
      target.setHours(intendedHours, intendedMinutes, 0, 0);
      return target;
    }

    const nextWeek = isHistoricalDose
      ? addDays(parseISO(dose.scheduledDate), 7)
      : addDays(now, 7);
    nextWeek.setHours(intendedHours, intendedMinutes, 0, 0);
    return nextWeek;
  }

  function applyDelete(option: 'today' | 'forward') {
    const dose = deleteTargetDose;
    if (!dose) return;
    setDeleteTargetDose(null);
    if (option === 'today') {
      // For history dates skipDose leaves the card visible (shows as Skipped),
      // so hard-remove the dose row instead.
      if (dose.scheduledDate < todayStr) {
        removeDose(dose.id);
      } else {
        skipDose(dose.id);
      }
      show(`Dose removed for today`, 'warning');
    } else {
      endProtocolFromToday(dose.activeProtocolId, dose.scheduledDate);
      show(`${dose.protocolItem.name} removed from schedule`, 'warning');
    }
  }

  function applySnooze(option: '1h' | 'evening' | 'tomorrow' | 'next_week') {
    const targetDose = snoozeTargetDose;
    if (!targetDose) return;
    setSnoozeTargetDose(null);

    const until = new Date(getSnoozeUntil(targetDose, option));
    snoozeDose(targetDose.id, { until: until.toISOString() });
    const label =
      option === '1h'
        ? '1 hour'
        : option === 'evening'
          ? `to ${format(until, 'EEE, MMM d')} (${fmtTime(format(until, 'HH:mm'))})`
            : option === 'tomorrow'
            ? `to ${format(until, 'EEE, MMM d')} (${fmtTime(format(until, 'HH:mm'))})`
            : `to ${format(until, 'EEE, MMM d')} (${fmtTime(format(until, 'HH:mm'))})`;
    show(`⏰ Snoozed to ${label}`, 'warning');
  }

  return (
    <div className="flex flex-col h-full">
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
        {isFutureDate && (
          <div className="mb-4 rounded-2xl border border-[rgba(251,191,36,0.35)] bg-[rgba(251,191,36,0.1)] px-4 py-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-[#FBBF24]">Future Date</div>
            <div className="mt-1 text-sm text-[#F0F6FC]">
              Taking, skipping, and snoozing are disabled for future doses.
            </div>
          </div>
        )}
        {isHistoryDate && (
          <div className="mb-4 rounded-2xl border border-[rgba(251,191,36,0.35)] bg-[rgba(251,191,36,0.1)] px-4 py-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-[#FBBF24]">Past Date</div>
            <div className="mt-1 text-sm text-[#F0F6FC]">
              You can edit past doses only for active protocols. Resume paused protocols first.
            </div>
          </div>
        )}

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
              <button
                type="button"
                aria-label="Add dose manually"
                onClick={() => setSheetOpen(true)}
                className="text-sm font-semibold text-white bg-[#3B82F6] px-4 py-2.5 rounded-xl hover:bg-[#2563EB]"
              >
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
              (() => {
                const protocolLocked = dose.activeProtocol.status !== 'active';
                const actionsDisabled = isFutureDate || protocolLocked;
                const disabledMessage = protocolLocked
                  ? (isHistoryDate ? pausedHistoryActionMessage : pausedProtocolActionMessage)
                  : futureActionMessage;

                return (
                  <MedCard
                    key={dose.id}
                    dose={dose}
                    actionsDisabled={actionsDisabled}
                    takenAt={takenAtMap.get(dose.id)}
                    onTake={() => {
                      if (actionsDisabled) {
                        show(disabledMessage, 'warning');
                        return;
                      }
                      takeDose(dose.id);
                      show(`✓ ${dose.protocolItem.name} taken`);
                    }}
                    onSkip={() => {
                      if (actionsDisabled) {
                        show(disabledMessage, 'warning');
                        return;
                      }
                      skipDose(dose.id);
                      show(`Skipped ${dose.protocolItem.name}`, 'warning');
                    }}
                    onSnooze={() => {
                      if (actionsDisabled) {
                        show(disabledMessage, 'warning');
                        return;
                      }
                      setSnoozeTargetDose(dose);
                    }}
                    onDelete={() => setDeleteTargetDose(dose)}
                  />
                );
              })()
            ))}
          </div>
        ))}
      </div>

      {/* FAB */}
      <button
        type="button"
        aria-label="Open add dose sheet"
        onClick={() => setSheetOpen(true)}
        className="absolute bottom-24 right-5 w-12 h-12 bg-[#3B82F6] hover:bg-[#2563EB] rounded-[16px] shadow-[0_4px_20px_rgba(59,130,246,0.5)] flex items-center justify-center text-2xl text-white transition-all duration-200 z-10"
      >
        ＋
      </button>

      <AddDoseSheet open={sheetOpen} onClose={() => setSheetOpen(false)} />
      {deleteTargetDose && (
        <div className="fixed inset-0 z-40 bg-black/50 flex items-end">
          <div className="w-full rounded-t-2xl bg-[#0F172A] border-t border-[rgba(255,255,255,0.08)] p-4 pb-6">
            <div className="text-sm font-bold text-[#F0F6FC] mb-1">Remove dose</div>
            <div className="text-xs text-[#8B949E] mb-3">{deleteTargetDose.protocolItem.name}</div>
            <div className="flex flex-col gap-2">
              <button type="button" aria-label="Delete today only" onClick={() => applyDelete('today')} className="bg-[#1C2333] border border-[rgba(255,255,255,0.08)] rounded-xl py-3 text-sm text-[#F0F6FC] font-semibold">Delete today only</button>
              <button type="button" aria-label="Delete from all following days" onClick={() => applyDelete('forward')} className="bg-[#1C2333] border border-red-900/50 rounded-xl py-3 text-sm text-red-400 font-semibold">Delete from all following days</button>
            </div>
            <button type="button" aria-label="Cancel delete" onClick={() => setDeleteTargetDose(null)} className="w-full mt-2 rounded-xl py-3 text-sm font-semibold text-[#8B949E]">Cancel</button>
          </div>
        </div>
      )}
      {snoozeTargetDose && (
        <div className="fixed inset-0 z-40 bg-black/50 flex items-end">
          <div className="w-full rounded-t-2xl bg-[#0F172A] border-t border-[rgba(255,255,255,0.08)] p-4 pb-6">
            <div className="text-sm font-bold text-[#F0F6FC] mb-1">Snooze dose</div>
            <div className="text-xs text-[#8B949E] mb-3">
              {snoozeTargetDose.protocolItem.name}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" aria-label="Snooze by one hour" onClick={() => applySnooze('1h')} className="bg-[#1C2333] border border-[rgba(255,255,255,0.08)] rounded-xl py-3 text-sm text-[#F0F6FC] font-semibold">1 hour</button>
              <button type="button" aria-label="Snooze until this evening" onClick={() => applySnooze('evening')} className="bg-[#1C2333] border border-[rgba(255,255,255,0.08)] rounded-xl py-3 text-sm text-[#F0F6FC] font-semibold">This evening</button>
              <button type="button" aria-label="Snooze until tomorrow" onClick={() => applySnooze('tomorrow')} className="bg-[#1C2333] border border-[rgba(255,255,255,0.08)] rounded-xl py-3 text-sm text-[#F0F6FC] font-semibold">Tomorrow</button>
              <button type="button" aria-label="Snooze until next week" onClick={() => applySnooze('next_week')} className="bg-[#1C2333] border border-[rgba(255,255,255,0.08)] rounded-xl py-3 text-sm text-[#F0F6FC] font-semibold">Next week</button>
            </div>
            <button type="button" aria-label="Cancel snooze selection" onClick={() => setSnoozeTargetDose(null)} className="w-full mt-2 rounded-xl py-3 text-sm font-semibold text-[#8B949E]">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
