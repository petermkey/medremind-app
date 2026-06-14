import type { ActiveProtocol, ScheduledDose } from '../../types';

// Pure core of getDayScheduleFromState — todayDate is injected so the
// function is clock-free and unit-testable in the standalone test harness.
//
// Past dates: handled doses (taken/skipped — real history) from any
// instance, plus pending doses of currently-active instances (genuine
// misses). Never-actioned pending rows of paused/abandoned/completed
// protocols are noise: they were not expected to be taken and would render
// as fake "overdue" entries and poison adherence stats.
// Today/future: only doses belonging to active protocol instances.
export function getDayScheduleForDate(
  scheduledDoses: ScheduledDose[],
  activeProtocols: ActiveProtocol[],
  date: string,
  todayDate: string,
): ScheduledDose[] {
  const sorted = (arr: ScheduledDose[]) =>
    [...arr].sort((a, b) => a.scheduledTime.localeCompare(b.scheduledTime));
  const activeIds = new Set(
    activeProtocols.filter(ap => ap.status === 'active').map(ap => ap.id),
  );
  if (date < todayDate) {
    return sorted(scheduledDoses.filter(d =>
      d.scheduledDate === date && (d.status !== 'pending' || activeIds.has(d.activeProtocolId)),
    ));
  }
  return sorted(
    scheduledDoses.filter(d => d.scheduledDate === date && activeIds.has(d.activeProtocolId)),
  );
}

// Calendar day number of `targetDate` within a protocol that started on
// `startDate` (both YYYY-MM-DD). Day of startDate is 1. Pure UTC math so DST
// transitions never shift the count.
export function protocolDayNumber(startDate: string, targetDate: string): number {
  const [sy, sm, sd] = startDate.slice(0, 10).split('-').map(Number);
  const [ty, tm, td] = targetDate.slice(0, 10).split('-').map(Number);
  return Math.floor((Date.UTC(ty, tm - 1, td) - Date.UTC(sy, sm - 1, sd)) / 86400000) + 1;
}
