// One-off, idempotent: recompute Sprint 1 columns for every existing Oura
// snapshot row from its stored raw_payload. No Oura API calls.
// Run: set -a && source .env.local && set +a && \
//   node --experimental-strip-types scripts/backfill-oura-night-detail.mjs
import { createClient } from '@supabase/supabase-js';

import {
  hrvRecoveryDelta,
  parseSleepPhaseFeatures,
} from '../src/lib/health/nightDetail.ts';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const numberOrNull = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const minutesOrNull = (value) => (numberOrNull(value) === null ? null : Math.round(value / 60));

const { data: rows, error } = await supabase
  .from('external_health_daily_snapshots')
  .select('id, local_date, raw_payload')
  .eq('source', 'oura')
  .order('local_date', { ascending: true });
if (error) throw error;

let updated = 0;
for (const row of rows) {
  const raw = row.raw_payload ?? {};
  const phases = parseSleepPhaseFeatures(raw.sleepDetail?.sleep_phase_30_sec);
  const patch = {
    temperature_deviation: numberOrNull(raw.dailyReadiness?.temperature_deviation),
    temperature_trend_deviation: numberOrNull(raw.dailyReadiness?.temperature_trend_deviation),
    non_wear_minutes: minutesOrNull(raw.dailyActivity?.non_wear_time),
    deep_sleep_first_third_minutes: phases.deepSleepFirstThirdMinutes,
    minutes_to_first_deep_sleep: phases.minutesToFirstDeepSleep,
    hrv_recovery_delta: hrvRecoveryDelta(raw.sleepDetail?.hrv),
    updated_at: new Date().toISOString(),
  };
  const { error: updateError } = await supabase
    .from('external_health_daily_snapshots')
    .update(patch)
    .eq('id', row.id);
  if (updateError) throw updateError;
  updated += 1;
}

console.log(`backfilled ${updated}/${rows.length} oura snapshot rows`);
