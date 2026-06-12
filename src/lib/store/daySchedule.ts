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
