import { createClient as createServiceClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

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

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function publicMapItem(row: Row) {
  return {
    id: String(row.id),
    displayName: String(row.display_name ?? 'Medication'),
    genericName: typeof row.generic_name === 'string' ? row.generic_name : null,
    doseLabel: [row.dose_amount, row.dose_unit].filter(Boolean).join(' ') || null,
    route: typeof row.route === 'string' ? row.route : null,
    frequencyType: typeof row.frequency_type === 'string' ? row.frequency_type : null,
    status: typeof row.status === 'string' ? row.status : 'unknown',
    startDate: typeof row.start_date === 'string' ? row.start_date : null,
    endDate: typeof row.end_date === 'string' ? row.end_date : null,
  };
}

function publicRule(row: Row) {
  return {
    id: String(row.id),
    medicationMapItemId: String(row.medication_map_item_id),
    ruleId: String(row.rule_id),
    domain: String(row.domain),
    recommendationKind: String(row.recommendation_kind),
    riskLevel: String(row.risk_level),
    title: String(row.title),
    body: String(row.body),
    evidenceLabels: asStringArray(row.evidence_refs).map((ref) => ref.replace(/^curated_rule:/, 'Curated rule: ')),
  };
}

function classSummary(rows: Row[]) {
  const counts = new Map<string, number>();

  for (const row of rows) {
    for (const label of asStringArray(row.class_labels)) {
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
  }

  return Array.from(counts.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export async function GET() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const service = serviceClient();
    const userId = data.user.id;
    const [mapResult, normalizationResult, ruleResult, exposureResult, jobResult] = await Promise.all([
      service
        .from('medication_map_items')
        .select('id, display_name, generic_name, dose_amount, dose_unit, route, frequency_type, status, start_date, end_date, updated_at')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false })
        .limit(50),
      service
        .from('medication_normalizations')
        .select('medication_map_item_id, normalized_name, class_labels, source, confidence, updated_at')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false })
        .limit(50),
      service
        .from('medication_rule_evaluations')
        .select('id, medication_map_item_id, rule_id, domain, recommendation_kind, risk_level, title, body, evidence_refs, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(50),
      service
        .from('daily_medication_exposures')
        .select('local_date, medication_class_exposure_score, medication_review_signal_count, updated_at')
        .eq('user_id', userId)
        .order('local_date', { ascending: false })
        .limit(1),
      service
        .from('medication_processing_jobs')
        .select('status, job_type, input_window_start, input_window_end, last_error, updated_at')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false })
        .limit(1),
    ]);

    const firstError = mapResult.error ?? normalizationResult.error ?? ruleResult.error ?? exposureResult.error ?? jobResult.error;
    if (firstError) throw firstError;

    const mapItems = (mapResult.data as unknown as Row[] | null) ?? [];
    const normalizations = (normalizationResult.data as unknown as Row[] | null) ?? [];
    const rules = (ruleResult.data as unknown as Row[] | null) ?? [];
    const latestExposure = ((exposureResult.data as unknown as Row[] | null) ?? [])[0] ?? null;
    const latestJob = ((jobResult.data as unknown as Row[] | null) ?? [])[0] ?? null;

    return NextResponse.json({
      counts: {
        mapItems: mapItems.length,
        normalizations: normalizations.length,
        rules: rules.length,
        clinicianReviewFlags: rules.filter((rule) => rule.recommendation_kind === 'clinician_review').length,
        dailyExposures: latestExposure ? 1 : 0,
      },
      lastRun: latestJob
        ? {
            status: latestJob.status,
            jobType: latestJob.job_type,
            windowStart: latestJob.input_window_start,
            windowEnd: latestJob.input_window_end,
            lastError: latestJob.last_error ? 'Last refresh failed. Try again.' : null,
            updatedAt: latestJob.updated_at,
          }
        : null,
      activeMedications: mapItems.map(publicMapItem),
      matchedClasses: classSummary(normalizations),
      lifestyleRules: rules.map(publicRule),
      latestExposure: latestExposure
        ? {
            localDate: latestExposure.local_date,
            medicationClassExposureScore: latestExposure.medication_class_exposure_score,
            medicationReviewSignalCount: latestExposure.medication_review_signal_count,
            updatedAt: latestExposure.updated_at,
          }
        : null,
    });
  } catch (err) {
    console.error('[medication-knowledge/status] failed', err);
    return NextResponse.json({ error: 'Medication knowledge status unavailable.' }, { status: 500 });
  }
}
