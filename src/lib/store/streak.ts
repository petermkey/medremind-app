export interface StreakDay {
  scheduled: number; // doses scheduled that day
  taken: number;     // of those, how many taken
}

// days ordered most-recent-first: index 0 is the current day (may be in
// progress). A day with no scheduled doses is neutral (neither breaks nor
// extends the streak). The current day being incomplete does not break it.
export function computeStreak(days: readonly StreakDay[]): number {
  let count = 0;
  for (let i = 0; i < days.length; i++) {
    const { scheduled, taken } = days[i];
    if (scheduled === 0) continue;        // rest day — neutral
    if (taken >= scheduled) {
      count++;                            // all taken
      continue;
    }
    // incomplete day with scheduled doses
    if (i === 0) continue;                // today incomplete — skip, keep looking back
    break;                                // a past miss ends the streak; keep the run so far
  }
  return count;
}
