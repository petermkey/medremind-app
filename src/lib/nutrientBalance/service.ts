// Server-only orchestration for Nutrient Balance: cache check -> fetch stack
// + 14d food rows -> ensure facts (LLM once per unique supplement, cached in
// supplement_nutrient_facts forever) -> deterministic engine -> cache row.
import * as Sentry from '@sentry/nextjs';
import { createCorrelationServiceClient } from '@/lib/correlation/persistence';
import {
  aggregateFoodDailyAverages,
  buildNutrientBalanceReport,
  dosesPerDay,
  type NutrientBalanceReport,
  type StackItemInput,
} from './engine';
import { extractSupplementFacts } from './factsExtractor';
import { normalizeSupplementName } from './factsSchema';
import { NUTRIENT_LIMITS_VERSION } from './limits';

type Row = Record<string, unknown>;

export type NutrientBalanceResponse = {
  report: NutrientBalanceReport;
  pendingItems: string[];
  loggedDays: number;
  insufficientFoodData: boolean;
  limitsVersion: string;
};

const FOOD_WINDOW_DAYS = 14;
const MIN_LOGGED_DAYS = 3;
const MAX_EXTRACTIONS_PER_RUN = 5;

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function localDateFor(iso: string, timezone: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const map = new Map(parts.map(part => [part.type, part.value]));
    const year = map.get('year');
    const month = map.get('month');
    const day = map.get('day');
    return year && month && day ? `${year}-${month}-${day}` : null;
  } catch {
    return null;
  }
}

function factKey(normalizedName: string, doseAmount: number, doseUnit: string): string {
  return `${normalizedName}|${doseAmount}|${doseUnit.toLowerCase()}`;
}

export async function getNutrientBalance(
  userId: string,
  options: { refresh?: boolean } = {},
): Promise<NutrientBalanceResponse> {
  const supabase = createCorrelationServiceClient();

  const { data: profileRow } = await supabase
    .from('profiles')
    .select('timezone')
    .eq('id', userId)
    .maybeSingle();
  const profile = profileRow as Row | null;
  const timezone = typeof profile?.timezone === 'string' ? profile.timezone : 'UTC';
  const today = localDateFor(new Date().toISOString(), timezone) ?? new Date().toISOString().slice(0, 10);

  if (!options.refresh) {
    const { data: cached, error: cacheError } = await supabase
      .from('nutrient_balance_reports')
      .select('payload')
      .eq('user_id', userId)
      .eq('report_date', today)
      .eq('limits_version', NUTRIENT_LIMITS_VERSION)
      .maybeSingle();
    const cachedPayload = (cached as Row | null)?.payload;
    if (!cacheError && cachedPayload) {
      return cachedPayload as NutrientBalanceResponse;
    }
  }

  const windowStart = new Date();
  windowStart.setUTCDate(windowStart.getUTCDate() - (FOOD_WINDOW_DAYS - 1));
  const fromIso = `${windowStart.toISOString().slice(0, 10)}T00:00:00.000Z`;

  const [targetsResult, foodResult, stackResult] = await Promise.all([
    supabase
      .from('nutrition_target_profiles')
      .select('protein_g, fiber_g')
      .eq('user_id', userId)
      .maybeSingle(),
    supabase
      .from('food_entries')
      .select('consumed_at, timezone, protein_g, fiber_g, extended_nutrients')
      .eq('user_id', userId)
      .gte('consumed_at', fromIso),
    supabase
      .from('medication_map_items')
      .select('display_name, dose_amount, dose_unit, frequency_type, times')
      .eq('user_id', userId)
      .eq('status', 'active'),
  ]);
  if (foodResult.error) throw foodResult.error;
  if (stackResult.error) throw stackResult.error;

  const foodRows = (foodResult.data as Row[] | null) ?? [];
  const loggedDayset = new Set<string>();
  for (const row of foodRows) {
    if (typeof row.consumed_at !== 'string') continue;
    const rowTz = typeof row.timezone === 'string' && row.timezone ? row.timezone : timezone;
    const localDate = localDateFor(row.consumed_at, rowTz);
    if (localDate) loggedDayset.add(localDate);
  }
  const loggedDays = loggedDayset.size;

  const mapRows = (stackResult.data as Row[] | null) ?? [];
  const pendingItems: string[] = [];
  type PreparedItem = {
    displayName: string;
    normalizedName: string;
    doseAmount: number;
    doseUnit: string;
    dosesPerDay: number;
  };
  const prepared: PreparedItem[] = [];
  for (const row of mapRows) {
    const displayName = typeof row.display_name === 'string' ? row.display_name : null;
    if (!displayName) continue;
    const doseAmount = toNumber(row.dose_amount);
    const doseUnit = typeof row.dose_unit === 'string' && row.dose_unit ? row.dose_unit : null;
    if (doseAmount === null || doseAmount <= 0 || !doseUnit) {
      pendingItems.push(displayName);
      continue;
    }
    prepared.push({
      displayName,
      normalizedName: normalizeSupplementName(displayName),
      doseAmount,
      doseUnit,
      dosesPerDay: dosesPerDay(
        typeof row.frequency_type === 'string' ? row.frequency_type : 'daily',
        Array.isArray(row.times) ? (row.times as string[]) : null,
      ),
    });
  }

  const factsByKey = new Map<string, { nutrients: Record<string, number>; validationStatus: string }>();
  if (prepared.length > 0) {
    const { data: factRows, error: factsError } = await supabase
      .from('supplement_nutrient_facts')
      .select('normalized_name, dose_amount, dose_unit, nutrients, validation_status')
      .in('normalized_name', [...new Set(prepared.map(item => item.normalizedName))]);
    if (factsError) throw factsError;
    for (const row of (factRows as Row[] | null) ?? []) {
      const amount = toNumber(row.dose_amount);
      if (
        typeof row.normalized_name !== 'string' ||
        amount === null ||
        typeof row.dose_unit !== 'string'
      ) {
        continue;
      }
      factsByKey.set(factKey(row.normalized_name, amount, row.dose_unit), {
        nutrients: (row.nutrients as Record<string, number> | null) ?? {},
        validationStatus: typeof row.validation_status === 'string' ? row.validation_status : 'pending',
      });
    }
  }

  let extractions = 0;
  for (const item of prepared) {
    const key = factKey(item.normalizedName, item.doseAmount, item.doseUnit);
    if (factsByKey.has(key)) continue;
    if (extractions >= MAX_EXTRACTIONS_PER_RUN) {
      pendingItems.push(item.displayName);
      continue;
    }
    extractions += 1;
    try {
      const extracted = await extractSupplementFacts({
        normalizedName: item.normalizedName,
        doseAmount: item.doseAmount,
        doseUnit: item.doseUnit,
      });
      const { error: insertError } = await supabase.from('supplement_nutrient_facts').upsert(
        {
          normalized_name: item.normalizedName,
          dose_amount: item.doseAmount,
          dose_unit: item.doseUnit,
          nutrients: extracted.nutrients,
          model: extracted.model,
          validation_status: 'pending',
        },
        { onConflict: 'normalized_name,dose_amount,dose_unit', ignoreDuplicates: true },
      );
      if (insertError) throw insertError;
      factsByKey.set(key, { nutrients: extracted.nutrients, validationStatus: 'pending' });
    } catch (error) {
      Sentry.captureException(error);
      pendingItems.push(item.displayName);
    }
  }

  const stack: StackItemInput[] = [];
  for (const item of prepared) {
    const fact = factsByKey.get(factKey(item.normalizedName, item.doseAmount, item.doseUnit));
    if (!fact) continue;
    stack.push({
      displayName: item.displayName,
      nutrients: fact.nutrients,
      dosesPerDay: item.dosesPerDay,
      validationStatus: fact.validationStatus,
    });
  }

  const targetsRow = targetsResult.data as Row | null;
  const report = buildNutrientBalanceReport({
    foodDailyAvg: aggregateFoodDailyAverages(foodRows, loggedDays),
    stack,
    targets: {
      proteinG: toNumber(targetsRow?.protein_g),
      fiberG: toNumber(targetsRow?.fiber_g),
    },
  });

  const response: NutrientBalanceResponse = {
    report,
    pendingItems,
    loggedDays,
    insufficientFoodData: loggedDays < MIN_LOGGED_DAYS,
    limitsVersion: NUTRIENT_LIMITS_VERSION,
  };

  const { error: upsertError } = await supabase.from('nutrient_balance_reports').upsert(
    {
      user_id: userId,
      report_date: today,
      payload: response,
      limits_version: NUTRIENT_LIMITS_VERSION,
      computed_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,report_date' },
  );
  if (upsertError) Sentry.captureException(upsertError);

  return response;
}
