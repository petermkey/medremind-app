'use client';
import { useMemo, useState, useEffect } from 'react';
import { addDays, addMinutes, format, parseISO } from 'date-fns';
import { useStore } from '@/lib/store/store';
import { useFoodStore } from '@/lib/store/foodStore';
import { computeEatingWindow } from '@/lib/nutrition/eatingWindow';
import { computeAdjustedReminderTime, deriveEatingPattern, hhmmFromMinutes, minutesFromHHMM } from '@/lib/push/foodTiming';
import { WeekStrip } from '@/components/app/WeekStrip';
import { MedCard } from '@/components/app/MedCard';
import { AddDoseSheet } from '@/components/app/AddDoseSheet';
import { MorningBriefingCard } from '@/components/app/MorningBriefingCard';
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
    getStreak,
    takeDose,
    skipDose,
    snoozeDose,
    removeDose,
    endProtocolFromToday,
    scheduledDoses,
    doseRecords,
    notificationSettings,
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

  const { entries: foodEntries, loadEntriesForRange } = useFoodStore();
  const smartTimingOn = notificationSettings.smartFoodTiming;

  // W4-A: the hint needs 14d of food entries; load once when the toggle is on.
  useEffect(() => {
    if (!profile?.id || !smartTimingOn) return;
    const to = new Date();
    const from = new Date(to.getTime() - 14 * 24 * 60 * 60 * 1000);
    void loadEntriesForRange(profile.id, from.toISOString(), to.toISOString());
  }, [profile?.id, smartTimingOn, loadEntriesForRange]);

  const eatingPattern = useMemo(() => {
    if (!smartTimingOn) return null;
    const tz = profile?.timezone && profile.timezone.trim().length > 0
      ? profile.timezone
      : Intl.DateTimeFormat().resolvedOptions().timeZone;
    const days: { firstMeal: string | null; lastMeal: string | null }[] = [];
    for (let i = 1; i <= 14; i += 1) {
      const date = format(addDays(parseISO(todayStr), -i), 'yyyy-MM-dd');
      const window = computeEatingWindow(foodEntries, date, tz);
      days.push({ firstMeal: window.firstMeal, lastMeal: window.lastMeal });
    }
    return deriveEatingPattern(days);
  }, [smartTimingOn, foodEntries, profile?.timezone, todayStr]);

  // Same pure function as the cron route → hint and push agree by construction.
  function smartHintFor(dose: PlannedOccurrence): string | null {
    if (!eatingPattern || isHistoryDate || dose.status !== 'pending') return null;
    const minutes = minutesFromHHMM(dose.scheduledTime);
    if (minutes === null) return null;
    const adjusted = computeAdjustedReminderTime({
      occurrenceMinutes: minutes,
      withFood: dose.protocolItem.withFood ?? null,
      pattern: eatingPattern,
      isSnoozeReplacement: Boolean(dose.predecessorDoseId),
      quietWindow: null, // v1 limitation — see Task 5 Interfaces note
    });
    return adjusted === null ? null : hhmmFromMinutes(adjusted);
  }

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

  const { taken, total } = useMemo(
    () => {
      if (!isHistoryDate) return selectAppSummaryMetrics(selectedDate);
      const historyTotal = actionableDoses.length;
      const historyTaken = actionableDoses.filter(d => d.status === 'taken').length;
      return { taken: historyTaken, total: historyTotal };
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
    show(`Snoozed to ${label}`, 'warning');
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-5 pb-4 flex-shrink-0">
        <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--faint)]">
          {format(parseISO(selectedDate), 'EEE d MMM')}
        </div>
        <div className="flex justify-between items-center mt-1 mb-3">
          <div>
            <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--muted)]">{greeting()}</div>
            <div className="text-2xl font-semibold tracking-[-0.02em] text-[var(--text)]">{profile?.name}</div>
          </div>
          <Link
            href="/app/settings"
            className="w-9 h-9 rounded-full bg-gradient-to-br from-[var(--blue)] to-[var(--purple)] flex items-center justify-center text-sm font-bold text-[var(--blue-on)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--blue)] focus-visible:outline-offset-2"
          >
            {profile?.name?.charAt(0).toUpperCase()}
          </Link>
        </div>

        {/* Status strip — 3 stats with hairline dividers */}
        <div className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 flex items-center gap-4">
          <div className="flex-1">
            <div className="font-mono tabular-nums text-[22px] font-semibold leading-none text-[var(--text)]">
              {taken}<span className="text-[var(--faint)]">/{total}</span>
            </div>
            <div className="mt-1 text-[11px] text-[var(--muted)]">doses taken</div>
          </div>
          <div className="w-px h-[34px] bg-[var(--border)]" />
          <div className="flex-1">
            <div className="font-mono tabular-nums text-[22px] font-semibold leading-none text-[var(--text)]">
              {nextDose ? nextDose.scheduledTime : '—'}
            </div>
            <div className="mt-1 text-[11px] text-[var(--muted)]">next dose</div>
          </div>
          <div className="w-px h-[34px] bg-[var(--border)]" />
          <div className="flex-1">
            <div className="font-mono tabular-nums text-[22px] font-semibold leading-none text-[var(--blue-text)]">
              {getStreak()}
            </div>
            <div className="mt-1 text-[11px] text-[var(--muted)]">day streak</div>
          </div>
        </div>

        <WeekStrip selectedDate={selectedDate} onSelectDate={setSelectedDate} doseDateSet={doseDateSet} />
      </div>

      {/* Scroll area */}
      <div className="flex-1 overflow-y-auto px-5 pb-4">
        {isFutureDate && (
          <div className="mb-4 rounded-2xl border border-[rgba(var(--yellow-rgb),0.35)] bg-[rgba(var(--yellow-rgb),0.1)] px-4 py-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-[var(--yellow)]">Future Date</div>
            <div className="mt-1 text-sm text-[var(--text)]">
              Taking, skipping, and snoozing are disabled for future doses.
            </div>
          </div>
        )}
        {isHistoryDate && (
          <div className="mb-4 rounded-2xl border border-[rgba(var(--yellow-rgb),0.35)] bg-[rgba(var(--yellow-rgb),0.1)] px-4 py-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-[var(--yellow)]">Past Date</div>
            <div className="mt-1 text-sm text-[var(--text)]">
              You can edit past doses only for active protocols. Resume paused protocols first.
            </div>
          </div>
        )}

        {/* Morning briefing (W3-B) — today only, opt-in via Settings */}
        {selectedDate === todayStr && notificationSettings.morningBriefingEnabled && (
          <MorningBriefingCard todayStr={todayStr} doseCount={total} />
        )}

        {/* Empty state */}
        {total === 0 && (
          <div className="text-center py-16 fade-in">
            <div className="text-base font-bold text-[var(--text)] mb-2">No doses scheduled</div>
            <div className="text-sm text-[var(--muted)] mb-6">Activate a protocol or add a medication to get started.</div>
            <div className="flex gap-3 justify-center">
              <Link href="/app/protocols" className="text-sm font-semibold text-[var(--blue-text)] border border-[rgba(var(--blue-rgb),0.3)] px-4 py-2.5 rounded-xl hover:bg-[rgba(var(--blue-rgb),0.1)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--blue)] focus-visible:outline-offset-2">
                Browse protocols
              </Link>
              <button
                type="button"
                aria-label="Add dose manually"
                onClick={() => setSheetOpen(true)}
                className="text-sm font-semibold text-[var(--blue-on)] bg-[var(--blue)] px-4 py-2.5 rounded-xl hover:bg-[var(--blue-dk)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--blue)] focus-visible:outline-offset-2"
              >
                + Add manually
              </button>
            </div>
          </div>
        )}

        {/* Grouped doses — vertical timeline rail */}
        {grouped.length > 0 && (
          <div className="relative pl-[18px]">
            <div className="absolute left-[3px] top-1.5 bottom-1.5 w-px bg-[var(--border)]" />
            {grouped.map(({ label, doses: group }) => (
              <div key={label} className="mb-6">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-[10px] font-mono font-bold text-[var(--muted)] uppercase tracking-wider">{label}</span>
                  <div className="flex-1 h-px bg-[rgba(var(--overlay-rgb),0.05)]" />
                </div>
                {group.map(dose => (
                  (() => {
                    const protocolLocked = dose.activeProtocol.status !== 'active';
                    const actionsDisabled = isFutureDate || protocolLocked;
                    const disabledMessage = protocolLocked
                      ? (isHistoryDate ? pausedHistoryActionMessage : pausedProtocolActionMessage)
                      : futureActionMessage;
                    const isNextDose = nextDose?.id === dose.id;
                    const dotClass =
                      dose.status === 'taken'
                        ? 'bg-[var(--green)]'
                        : dose.status === 'skipped'
                        ? 'bg-[var(--faint)]'
                        : isNextDose
                        ? 'bg-[var(--bg)] border-[1.5px] border-[var(--blue)]'
                        : 'bg-[var(--bg)] border-[1.5px] border-[var(--faint)]';

                    return (
                      <div key={dose.id} className="relative">
                        <span
                          aria-hidden="true"
                          className={`absolute left-[-23px] top-[18px] w-[7px] h-[7px] rounded-full ${dotClass}`}
                        />
                        <MedCard
                          dose={dose}
                          isNext={isNextDose}
                          actionsDisabled={actionsDisabled}
                          takenAt={takenAtMap.get(dose.id)}
                          smartAdjustedTime={smartHintFor(dose)}
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
                      </div>
                    );
                  })()
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* FAB */}
      <button
        type="button"
        aria-label="Open add dose sheet"
        onClick={() => setSheetOpen(true)}
        className="absolute bottom-24 right-5 w-12 h-12 bg-[var(--blue)] hover:bg-[var(--blue-dk)] rounded-[16px] shadow-[0_4px_20px_rgba(var(--blue-rgb),0.5)] flex items-center justify-center text-2xl text-[var(--blue-on)] transition-all duration-200 z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--blue)] focus-visible:outline-offset-2"
      >
        +
      </button>

      <AddDoseSheet open={sheetOpen} onClose={() => setSheetOpen(false)} />
      {deleteTargetDose && (
        <div className="fixed inset-0 z-40 bg-black/50 flex items-end">
          <div className="w-full rounded-t-2xl bg-[var(--bg-alt)] border-t border-[var(--border)] p-4 pb-6">
            <div className="text-sm font-bold text-[var(--text)] mb-1">Remove dose</div>
            <div className="text-xs text-[var(--muted)] mb-3">{deleteTargetDose.protocolItem.name}</div>
            <div className="flex flex-col gap-2">
              <button type="button" aria-label="Delete today only" onClick={() => applyDelete('today')} className="bg-transparent border border-[var(--border-strong)] rounded-xl py-3 text-sm text-[var(--muted)] font-semibold hover:border-[var(--faint)] hover:text-[var(--text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--blue)] focus-visible:outline-offset-2">Delete today only</button>
              <button type="button" aria-label="Delete from all following days" onClick={() => applyDelete('forward')} className="bg-transparent border border-red-900/50 rounded-xl py-3 text-sm text-red-400 font-semibold hover:border-red-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--blue)] focus-visible:outline-offset-2">Delete from all following days</button>
            </div>
            <button type="button" aria-label="Cancel delete" onClick={() => setDeleteTargetDose(null)} className="w-full mt-2 bg-transparent border border-[var(--border-strong)] rounded-xl py-3 text-sm font-semibold text-[var(--muted)] hover:border-[var(--faint)] hover:text-[var(--text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--blue)] focus-visible:outline-offset-2">Cancel</button>
          </div>
        </div>
      )}
      {snoozeTargetDose && (
        <div className="fixed inset-0 z-40 bg-black/50 flex items-end">
          <div className="w-full rounded-t-2xl bg-[var(--bg-alt)] border-t border-[var(--border)] p-4 pb-6">
            <div className="text-sm font-bold text-[var(--text)] mb-1">Snooze dose</div>
            <div className="text-xs text-[var(--muted)] mb-3">
              {snoozeTargetDose.protocolItem.name}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" aria-label="Snooze by one hour" onClick={() => applySnooze('1h')} className="bg-transparent border border-[var(--border-strong)] rounded-xl py-3 text-sm text-[var(--muted)] font-semibold hover:border-[var(--faint)] hover:text-[var(--text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--blue)] focus-visible:outline-offset-2">1 hour</button>
              <button type="button" aria-label="Snooze until this evening" onClick={() => applySnooze('evening')} className="bg-transparent border border-[var(--border-strong)] rounded-xl py-3 text-sm text-[var(--muted)] font-semibold hover:border-[var(--faint)] hover:text-[var(--text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--blue)] focus-visible:outline-offset-2">This evening</button>
              <button type="button" aria-label="Snooze until tomorrow" onClick={() => applySnooze('tomorrow')} className="bg-transparent border border-[var(--border-strong)] rounded-xl py-3 text-sm text-[var(--muted)] font-semibold hover:border-[var(--faint)] hover:text-[var(--text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--blue)] focus-visible:outline-offset-2">Tomorrow</button>
              <button type="button" aria-label="Snooze until next week" onClick={() => applySnooze('next_week')} className="bg-transparent border border-[var(--border-strong)] rounded-xl py-3 text-sm text-[var(--muted)] font-semibold hover:border-[var(--faint)] hover:text-[var(--text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--blue)] focus-visible:outline-offset-2">Next week</button>
            </div>
            <button type="button" aria-label="Cancel snooze selection" onClick={() => setSnoozeTargetDose(null)} className="w-full mt-2 bg-transparent border border-[var(--border-strong)] rounded-xl py-3 text-sm font-semibold text-[var(--muted)] hover:border-[var(--faint)] hover:text-[var(--text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--blue)] focus-visible:outline-offset-2">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
