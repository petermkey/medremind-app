import { createHash } from 'node:crypto';

import { createClient as createServiceClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

import { buildDailyMedicationExposure, type MedicationDoseSignal } from '@/lib/medKnowledge/features';
import {
  buildMedicationMapItems,
  type ActiveProtocolRow,
  type DrugRow,
  type ProtocolItemRow,
} from '@/lib/medKnowledge/mapReader';
import { normalizeMedicationFromLocalRules } from '@/lib/medKnowledge/normalizer';
import { CURATED_MEDICATION_RULES, type CuratedMedicationRule } from '@/lib/medKnowledge/rules';
import type { MedicationMapItem, MedicationNormalization, MedicationRuleEvaluation } from '@/lib/medKnowledge/types';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

type Row = Record<string, unknown>;

function serviceClient() {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Supabase service role environment is required.');
  }

  return createServiceClient(supabaseUrl, serviceRoleKey);
}

function addDays(localDate: string, days: number): string {
  const date = new Date(`${localDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function mapItemRow(item: MedicationMapItem) {
  return {
    user_id: item.userId,
    active_protocol_id: item.activeProtocolId,
    protocol_item_id: item.protocolItemId,
    drug_id: item.drugId ?? null,
    display_name: item.displayName,
    generic_name: item.genericName ?? null,
    dose_amount: item.doseAmount ?? null,
    dose_unit: item.doseUnit ?? null,
    dose_form: item.doseForm ?? null,
    route: item.route ?? null,
    frequency_type: item.frequencyType,
    times: item.times,
    with_food: item.withFood ?? null,
    start_date: item.startDate,
    end_date: item.endDate ?? null,
    status: item.status,
    source_hash: item.sourceHash,
    updated_at: new Date().toISOString(),
  };
}

function normalizationRow(userId: string, normalization: MedicationNormalization) {
  return {
    user_id: userId,
    medication_map_item_id: normalization.medicationMapItemId,
    rxnorm_rxcui: normalization.rxnormRxcui ?? null,
    normalized_name: normalization.normalizedName ?? null,
    ingredients: normalization.ingredients,
    class_codes: normalization.classCodes ?? [],
    class_labels: normalization.classLabels,
    source: normalization.source ?? 'manual',
    confidence: normalization.confidence ?? null,
    ambiguity_notes: normalization.ambiguityNotes ?? null,
    updated_at: new Date().toISOString(),
  };
}

function ruleRow(userId: string, evaluation: MedicationRuleEvaluation) {
  return {
    user_id: userId,
    medication_map_item_id: evaluation.medicationMapItemId,
    rule_id: evaluation.ruleId,
    domain: evaluation.domain,
    recommendation_kind: evaluation.recommendationKind,
    risk_level: evaluation.riskLevel,
    title: evaluation.title,
    body: evaluation.body,
    evidence_refs: evaluation.evidenceRefs ?? [],
  };
}

function exposureRow(exposure: ReturnType<typeof buildDailyMedicationExposure>) {
  return {
    user_id: exposure.userId,
    local_date: exposure.localDate,
    has_glp1_active: exposure.hasGlp1Active,
    days_since_glp1_start: exposure.daysSinceGlp1Start,
    glp1_dose_escalation_phase: exposure.glp1DoseEscalationPhase,
    has_testosterone_active: exposure.hasTestosteroneActive,
    testosterone_injection_day_offset: exposure.testosteroneInjectionDayOffset,
    has_beta_blocker_active: exposure.hasBetaBlockerActive,
    has_thyroid_med_active: exposure.hasThyroidMedActive,
    has_ssri_active: exposure.hasSsriActive,
    with_food_mismatch_count: exposure.withFoodMismatchCount,
    late_medication_count: exposure.lateMedicationCount,
    missed_medication_count: exposure.missedMedicationCount,
    medication_class_exposure_score: exposure.medicationClassExposureScore,
    medication_review_signal_count: exposure.medicationReviewSignalCount,
    source_payload: exposure.sourcePayload,
    updated_at: new Date().toISOString(),
  };
}

function evidenceRow(rule: CuratedMedicationRule) {
  const excerpt = `${rule.title}. ${rule.body}`;
  return {
    source: 'curated_rule',
    source_url: null,
    source_version: 'medremind-curated-v1',
    source_retrieved_at: null,
    title: rule.title,
    section_name: rule.domain,
    content_hash: createHash('sha256').update(`${rule.id}:${excerpt}`).digest('hex'),
    content_excerpt: excerpt,
    retrieval_strategy: 'lexical',
    embedding_model: null,
    review_status: 'curated',
  };
}

function classHaystack(item: MedicationMapItem, normalization: MedicationNormalization): string {
  return [
    item.displayName,
    item.genericName,
    normalization.normalizedName,
    ...(normalization.ingredients ?? []),
    ...(normalization.classCodes ?? []),
    ...(normalization.classLabels ?? []),
  ].filter(Boolean).join(' ').toLowerCase();
}

function matchesRule(item: MedicationMapItem, normalization: MedicationNormalization, rule: CuratedMedicationRule): boolean {
  const haystack = classHaystack(item, normalization);
  if (rule.medicationClass === 'glp1') return haystack.includes('glp-1') || haystack.includes('glp1') || haystack.includes('semaglutide');
  if (rule.medicationClass === 'thyroid') return haystack.includes('thyroid') || haystack.includes('levothyroxine');
  return haystack.includes(rule.medicationClass);
}

function evaluateRules(
  userId: string,
  mapItems: MedicationMapItem[],
  normalizations: MedicationNormalization[],
): MedicationRuleEvaluation[] {
  const itemById = new Map(mapItems.map((item) => [item.id, item]));

  return normalizations.flatMap((normalization) => {
    const item = itemById.get(normalization.medicationMapItemId);
    if (!item) return [];

    return CURATED_MEDICATION_RULES
      .filter((rule) => matchesRule(item, normalization, rule))
      .map((rule) => ({
        userId,
        medicationMapItemId: normalization.medicationMapItemId,
        ruleId: rule.id,
        domain: rule.domain,
        recommendationKind: rule.recommendationKind,
        riskLevel: rule.riskLevel,
        title: rule.title,
        body: rule.body,
        evidenceRefs: rule.evidenceRefs,
      }));
  });
}

function toMapItem(item: MedicationMapItem, row: Row): MedicationMapItem {
  return {
    ...item,
    id: String(row.id),
  };
}

function toDoseSignal(row: Row, recordsByDoseId: Map<string, Row>): MedicationDoseSignal {
  const record = recordsByDoseId.get(String(row.id));
  return {
    medicationMapItemId: String(row.protocol_item_id),
    scheduledDate: String(row.scheduled_date),
    scheduledTime: String(row.scheduled_time).slice(0, 5),
    status: String(row.status),
    recordedAt: typeof record?.recorded_at === 'string' ? record.recorded_at : null,
    withFoodTaken: null,
  };
}

export async function POST() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const service = serviceClient();
  const userId = data.user.id;
  const windowEnd = todayUtc();
  const windowStart = addDays(windowEnd, -89);
  const idempotencyKey = `${userId}:medication_knowledge_refresh:${windowEnd}`;

  try {
    await service.from('medication_processing_jobs').upsert({
      user_id: userId,
      job_type: 'medication_map_refresh',
      status: 'running',
      idempotency_key: idempotencyKey,
      input_window_start: windowStart,
      input_window_end: windowEnd,
      attempt_count: 1,
      last_error: null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'idempotency_key' });

    const activeProtocolsResult = await service
      .from('active_protocols')
      .select('id, user_id, protocol_id, status, start_date, end_date')
      .eq('user_id', userId)
      .in('status', ['active', 'paused', 'completed']);
    if (activeProtocolsResult.error) throw activeProtocolsResult.error;

    const activeProtocols = (activeProtocolsResult.data as ActiveProtocolRow[] | null) ?? [];
    const protocolIds = Array.from(new Set(activeProtocols.map((row) => row.protocol_id)));
    const [protocolItemsResult, drugsResult] = await Promise.all([
      protocolIds.length > 0
        ? service
            .from('protocol_items')
            .select('id, protocol_id, item_type, name, drug_id, dose_amount, dose_unit, dose_form, route, frequency_type, times, with_food, start_day, end_day')
            .in('protocol_id', protocolIds)
        : Promise.resolve({ data: [], error: null }),
      service
        .from('drugs')
        .select('id, name, generic_name')
        .or(`is_custom.eq.false,created_by.eq.${userId}`),
    ]);
    if (protocolItemsResult.error) throw protocolItemsResult.error;
    if (drugsResult.error) throw drugsResult.error;

    const mapItems = buildMedicationMapItems({
      windowStart,
      windowEnd,
      activeProtocols,
      protocolItems: (protocolItemsResult.data as ProtocolItemRow[] | null) ?? [],
      drugs: (drugsResult.data as DrugRow[] | null) ?? [],
    });

    const mapUpsert = mapItems.length > 0
      ? await service
          .from('medication_map_items')
          .upsert(mapItems.map(mapItemRow), { onConflict: 'user_id,active_protocol_id,protocol_item_id' })
          .select('id, active_protocol_id, protocol_item_id')
      : { data: [], error: null };
    if (mapUpsert.error) throw mapUpsert.error;

    const rowKey = (row: Row) => `${row.active_protocol_id}:${row.protocol_item_id}`;
    const persistedRowsByKey = new Map(((mapUpsert.data as unknown as Row[] | null) ?? []).map((row) => [rowKey(row), row]));
    const persistedMapItems = mapItems
      .map((item) => {
        const row = persistedRowsByKey.get(`${item.activeProtocolId}:${item.protocolItemId}`);
        return row ? toMapItem(item, row) : null;
      })
      .filter((item): item is MedicationMapItem => item !== null);

    const normalizations = await Promise.all(
      persistedMapItems.map((item) =>
        normalizeMedicationFromLocalRules({
          medicationMapItemId: item.id ?? item.protocolItemId,
          displayName: item.displayName,
          genericName: item.genericName,
        }),
      ),
    );

    const normalizationUpsert = normalizations.length > 0
      ? await service
          .from('medication_normalizations')
          .upsert(normalizations.map((normalization) => normalizationRow(userId, normalization)), { onConflict: 'medication_map_item_id' })
      : { error: null };
    if (normalizationUpsert.error) throw normalizationUpsert.error;

    const evaluations = evaluateRules(userId, persistedMapItems, normalizations);
    const mapItemIds = persistedMapItems.map((item) => item.id).filter((id): id is string => Boolean(id));
    if (mapItemIds.length > 0) {
      const deleteRules = await service.from('medication_rule_evaluations').delete().in('medication_map_item_id', mapItemIds);
      if (deleteRules.error) throw deleteRules.error;
    }

    const ruleInsert = evaluations.length > 0
      ? await service.from('medication_rule_evaluations').insert(evaluations.map((evaluation) => ruleRow(userId, evaluation)))
      : { error: null };
    if (ruleInsert.error) throw ruleInsert.error;

    const matchedRuleIds = new Set(evaluations.map((evaluation) => evaluation.ruleId));
    const evidenceRows = CURATED_MEDICATION_RULES.filter((rule) => matchedRuleIds.has(rule.id)).map(evidenceRow);
    const evidenceUpsert = evidenceRows.length > 0
      ? await service.from('medication_evidence_documents').upsert(evidenceRows, { onConflict: 'source,content_hash' })
      : { error: null };
    if (evidenceUpsert.error) throw evidenceUpsert.error;

    const scheduledResult = await service
      .from('scheduled_doses')
      .select('id, protocol_item_id, scheduled_date, scheduled_time, status')
      .eq('user_id', userId)
      .eq('scheduled_date', windowEnd);
    if (scheduledResult.error) throw scheduledResult.error;

    const scheduledRows = (scheduledResult.data as unknown as Row[] | null) ?? [];
    const scheduledIds = scheduledRows.map((row) => String(row.id));
    const recordsResult = scheduledIds.length > 0
      ? await service.from('dose_records').select('scheduled_dose_id, recorded_at').eq('user_id', userId).in('scheduled_dose_id', scheduledIds)
      : { data: [], error: null };
    if (recordsResult.error) throw recordsResult.error;

    const recordsByDoseId = new Map(((recordsResult.data as unknown as Row[] | null) ?? []).map((row) => [String(row.scheduled_dose_id), row]));
    const doseSignals = scheduledRows.map((row) => toDoseSignal(row, recordsByDoseId));
    const exposure = buildDailyMedicationExposure({
      userId,
      localDate: windowEnd,
      mapItems: persistedMapItems,
      normalizations,
      doseSignals,
      reviewSignals: evaluations,
    });
    const exposureUpsert = await service
      .from('daily_medication_exposures')
      .upsert(exposureRow(exposure), { onConflict: 'user_id,local_date' });
    if (exposureUpsert.error) throw exposureUpsert.error;

    await service.from('medication_processing_jobs').upsert({
      user_id: userId,
      job_type: 'medication_map_refresh',
      status: 'completed',
      idempotency_key: idempotencyKey,
      input_window_start: windowStart,
      input_window_end: windowEnd,
      attempt_count: 1,
      last_error: null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'idempotency_key' });

    return NextResponse.json({
      counts: {
        mapItems: persistedMapItems.length,
        normalizations: normalizations.length,
        rules: evaluations.length,
        evidenceSources: evidenceRows.length,
        dailyExposures: 1,
      },
      lastRun: {
        status: 'completed',
        windowStart,
        windowEnd,
        updatedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error('[medication-knowledge/refresh] failed', err);
    await service.from('medication_processing_jobs').upsert({
      user_id: userId,
      job_type: 'medication_map_refresh',
      status: 'failed',
      idempotency_key: idempotencyKey,
      input_window_start: windowStart,
      input_window_end: windowEnd,
      attempt_count: 1,
      last_error: err instanceof Error ? err.message : 'Medication knowledge refresh failed.',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'idempotency_key' });

    return NextResponse.json({ error: 'Medication knowledge refresh failed.' }, { status: 500 });
  }
}
