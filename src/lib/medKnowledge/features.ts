import type { DailyMedicationExposure, MedicationMapItem, MedicationNormalization, MedicationRuleEvaluation } from './types';

export type MedicationDoseSignal = {
  medicationMapItemId: string;
  scheduledDate: string;
  scheduledTime: string;
  status: string;
  recordedAt?: string | null;
  withFoodTaken?: boolean | null;
};

export type BuildDailyMedicationExposureInput = {
  userId: string;
  localDate: string;
  mapItems: MedicationMapItem[];
  normalizations: Pick<MedicationNormalization, 'medicationMapItemId' | 'ingredients' | 'classLabels'>[];
  doseSignals?: MedicationDoseSignal[];
  reviewSignals?: Pick<MedicationRuleEvaluation, 'medicationMapItemId' | 'recommendationKind'>[];
};

export function buildDailyMedicationExposure(input: BuildDailyMedicationExposureInput): DailyMedicationExposure {
  const normalizationsByMapItemId = new Map(input.normalizations.map((normalization) => [normalization.medicationMapItemId, normalization]));
  const activeItems = input.mapItems.filter((item) => isActiveOnDate(item, input.localDate));
  const activeItemIds = new Set(activeItems.flatMap((item) => [item.id, item.protocolItemId]).filter(Boolean) as string[]);
  const localDoseSignals = (input.doseSignals ?? []).filter((signal) => signal.scheduledDate === input.localDate);
  const activeReviewSignals = (input.reviewSignals ?? []).filter((signal) => activeItemIds.has(signal.medicationMapItemId));
  const classFlags = activeItems.map((item) => classifyMedication(item, normalizationsByMapItemId.get(item.id ?? item.protocolItemId)));
  const glp1Items = activeItems.filter((item, index) => classFlags[index].glp1);
  const testosteroneItems = activeItems.filter((item, index) => classFlags[index].testosterone);
  const activeClassCount = countActiveClasses(classFlags);

  return {
    userId: input.userId,
    localDate: input.localDate,
    hasGlp1Active: glp1Items.length > 0,
    daysSinceGlp1Start: glp1Items.length > 0 ? daysSinceStart(glp1Items[0].startDate, input.localDate) : null,
    glp1DoseEscalationPhase: glp1Items.length > 0 && daysSinceStart(glp1Items[0].startDate, input.localDate) < 56,
    hasTestosteroneActive: testosteroneItems.length > 0,
    testosteroneInjectionDayOffset: testosteroneItems.length > 0 ? daysSinceStart(testosteroneItems[0].startDate, input.localDate) : null,
    hasBetaBlockerActive: classFlags.some((flags) => flags.betaBlocker),
    hasThyroidMedActive: classFlags.some((flags) => flags.thyroid),
    hasSsriActive: classFlags.some((flags) => flags.ssri),
    withFoodMismatchCount: countWithFoodMismatches(localDoseSignals, activeItems),
    lateMedicationCount: countLateMedicationSignals(localDoseSignals),
    missedMedicationCount: localDoseSignals.filter((signal) => ['skipped', 'missed', 'overdue'].includes(signal.status)).length,
    medicationClassExposureScore: activeClassCount,
    medicationReviewSignalCount: activeReviewSignals.filter((signal) => signal.recommendationKind === 'clinician_review').length,
    sourcePayload: {
      activeMedicationMapItemIds: activeItems.map((item) => item.id ?? item.protocolItemId),
      activeClassCount,
    },
  };
}

function classifyMedication(
  item: MedicationMapItem,
  normalization: Pick<MedicationNormalization, 'ingredients' | 'classLabels'> | undefined,
): Record<'glp1' | 'testosterone' | 'betaBlocker' | 'thyroid' | 'ssri', boolean> {
  const ingredients = [item.genericName, ...(normalization?.ingredients ?? [])].filter(Boolean).join(' ').toLowerCase();
  const classLabels = (normalization?.classLabels ?? []).join(' ').toLowerCase();

  return {
    glp1: classLabels.includes('glp-1') || ['semaglutide', 'tirzepatide', 'liraglutide', 'dulaglutide'].some((name) => ingredients.includes(name)),
    testosterone: ingredients.includes('testosterone') || classLabels.includes('androgen'),
    betaBlocker: classLabels.includes('beta blocker') || classLabels.includes('beta-blocker'),
    thyroid: ingredients.includes('levothyroxine') || classLabels.includes('thyroid'),
    ssri: classLabels.includes('selective serotonin reuptake') || classLabels.includes('ssri'),
  };
}

function isActiveOnDate(item: MedicationMapItem, localDate: string): boolean {
  return item.status === 'active' && item.startDate <= localDate && (item.endDate === null || item.endDate === undefined || item.endDate >= localDate);
}

function daysSinceStart(startDate: string, localDate: string): number {
  const startMs = Date.parse(`${startDate}T00:00:00.000Z`);
  const localMs = Date.parse(`${localDate}T00:00:00.000Z`);
  return Math.max(0, Math.floor((localMs - startMs) / 86_400_000));
}

function countActiveClasses(flags: Record<'glp1' | 'testosterone' | 'betaBlocker' | 'thyroid' | 'ssri', boolean>[]): number {
  return (['glp1', 'testosterone', 'betaBlocker', 'thyroid', 'ssri'] as const)
    .filter((className) => flags.some((flag) => flag[className]))
    .length;
}

function countWithFoodMismatches(doseSignals: MedicationDoseSignal[], activeItems: MedicationMapItem[]): number {
  const activeItemsById = new Map(activeItems.flatMap((item) => [[item.id, item], [item.protocolItemId, item]]).filter(([id]) => Boolean(id)) as [string, MedicationMapItem][]);

  return doseSignals.filter((signal) => {
    if (signal.withFoodTaken === null || signal.withFoodTaken === undefined) return false;
    const item = activeItemsById.get(signal.medicationMapItemId);
    if (!item) return false;
    if (item.withFood === 'yes') return signal.withFoodTaken === false;
    if (item.withFood === 'no') return signal.withFoodTaken === true;
    return false;
  }).length;
}

function countLateMedicationSignals(doseSignals: MedicationDoseSignal[]): number {
  return doseSignals.filter((signal) => {
    if (signal.status !== 'taken' || !signal.recordedAt) return false;
    const scheduledAt = Date.parse(`${signal.scheduledDate}T${signal.scheduledTime}:00.000Z`);
    const recordedAt = Date.parse(signal.recordedAt);
    return Number.isFinite(scheduledAt) && Number.isFinite(recordedAt) && recordedAt - scheduledAt > 30 * 60 * 1000;
  }).length;
}
