'use client';

import { type ChangeEvent, type PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from 'react';
import { format } from 'date-fns';
import { useStore } from '@/lib/store/store';
import { useFoodStore, type FoodStoreState } from '@/lib/store/foodStore';
import { useNutritionTargetsStore } from '@/lib/store/nutritionTargetsStore';
import {
  calculateNutritionTargets,
  NUTRITION_TARGET_ALGORITHM_VERSION,
  validateNutritionTargetInput,
  validateNutritionTargetProfileTargets,
} from '@/lib/food/targetAlgorithm';
import { consumedAtForSelectedDateInTimezone } from '@/lib/nutrition/waterEntryTime';
import type { FoodAnalysisDraft, FoodEntry, FoodNutrients } from '@/types/food';
import type {
  GeneratedNutritionTargets,
  NutritionActivityLevel,
  NutritionBodyFatRange,
  NutritionGoalMode,
  NutritionTargetInput,
  NutritionTargetProfile,
  NutritionTargetSex,
} from '@/types/nutritionTargets';

type FoodStoreWithOptionalDelete = FoodStoreState & {
  deleteFoodEntry?: (entryId: string, userId?: string) => void;
};

type SetupStep = 'input' | 'review';

type TargetInputField = 'ageYears' | 'weightKg' | 'heightCm';
type TargetInputForm = Record<TargetInputField, string> & {
  sex: NutritionTargetSex;
  activityLevel: NutritionActivityLevel;
  bodyFatRange: NutritionBodyFatRange;
  goalMode: NutritionGoalMode;
};

type TargetReviewForm = {
  caloriesKcal: string;
  proteinG: string;
  fatG: string;
  carbsG: string;
  fiberG: string;
  waterMl: string;
};

const TARGET_INPUT_DEFAULTS: TargetInputForm = {
  ageYears: '',
  sex: 'other_or_prefer_not_to_say',
  weightKg: '',
  heightCm: '',
  activityLevel: 'moderate',
  bodyFatRange: 'unknown',
  goalMode: 'stabilization',
};

const ACTIVITY_OPTIONS: { value: NutritionActivityLevel; label: string }[] = [
  { value: 'sedentary', label: 'Sedentary - mostly sitting' },
  { value: 'light', label: 'Light - training 1-2 days/week' },
  { value: 'moderate', label: 'Moderate - training 3-5 days/week' },
  { value: 'high', label: 'High - hard training most days' },
  { value: 'athlete', label: 'Athlete - intense daily training' },
];

const GOAL_OPTIONS: { value: NutritionGoalMode; label: string }[] = [
  { value: 'bulk', label: 'Bulk' },
  { value: 'lean-dry', label: 'Lean-dry' },
  { value: 'stabilization', label: 'Stabilization' },
  { value: 'recomposition', label: 'Recomposition' },
];

const BODY_FAT_OPTIONS: { value: NutritionBodyFatRange; label: string }[] = [
  { value: 'unknown', label: 'Unknown' },
  { value: '<10%', label: '<10%' },
  { value: '10-15%', label: '10-15%' },
  { value: '15-20%', label: '15-20%' },
  { value: '20-25%', label: '20-25%' },
  { value: '25%+', label: '25%+' },
];

const TARGET_CARDS = [
  { key: 'caloriesKcal', totalKey: 'caloriesKcal', label: 'Calories', unit: 'kcal' },
  { key: 'proteinG', totalKey: 'proteinG', label: 'Protein', unit: 'g' },
  { key: 'fatG', totalKey: 'totalFatG', label: 'Fat', unit: 'g' },
  { key: 'carbsG', totalKey: 'carbsG', label: 'Carbs', unit: 'g' },
  { key: 'fiberG', totalKey: 'fiberG', label: 'Fiber', unit: 'g' },
] as const;

const ENTRY_NUTRIENTS = [
  { key: 'caloriesKcal', label: 'kcal', unit: '' },
  { key: 'proteinG', label: 'Protein', unit: 'g' },
  { key: 'totalFatG', label: 'Fat', unit: 'g' },
  { key: 'carbsG', label: 'Carbs', unit: 'g' },
  { key: 'fiberG', label: 'Fiber', unit: 'g' },
] as const;

const DETAILED_NUTRIENTS = [
  { key: 'caloriesKcal', label: 'Calories', unit: 'kcal' },
  { key: 'proteinG', label: 'Protein', unit: 'g' },
  { key: 'totalFatG', label: 'Fat', unit: 'g' },
  { key: 'saturatedFatG', label: 'Sat fat', unit: 'g' },
  { key: 'carbsG', label: 'Carbs', unit: 'g' },
  { key: 'fiberG', label: 'Fiber', unit: 'g' },
  { key: 'sugarsG', label: 'Sugars', unit: 'g' },
  { key: 'sodiumMg', label: 'Sodium', unit: 'mg' },
] as const;

function isValidTimezoneCandidate(timezone?: string): timezone is string {
  const candidate = timezone?.trim();
  if (!candidate) return false;

  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate });
    return true;
  } catch {
    return false;
  }
}

function getResolvedTimezone(timezone?: string): string {
  const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const candidates = [timezone?.trim(), browserTimezone?.trim()];
  return candidates.find(isValidTimezoneCandidate) ?? 'UTC';
}

function currentDateForTimezone(timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date());
    const map = new Map(parts.map(part => [part.type, part.value]));
    const date = `${map.get('year')}-${map.get('month')}-${map.get('day')}`;
    if (date.length === 10) return date;
  } catch (error) {
    console.warn('[food-page-date-fallback]', error);
  }
  return format(new Date(), 'yyyy-MM-dd');
}

function rangeAroundLocalDate(date: string): { fromIso: string; toIso: string } {
  const start = new Date(`${date}T00:00:00`);
  start.setDate(start.getDate() - 7);
  const end = new Date(`${date}T23:59:59.999`);
  end.setDate(end.getDate() + 2);
  return { fromIso: start.toISOString(), toIso: end.toISOString() };
}

function dateStripDates(selectedDate: string, today: string): string[] {
  const selected = new Date(`${selectedDate}T12:00:00`);
  const todayDate = new Date(`${today}T12:00:00`);
  const anchor = selected > todayDate ? todayDate : selected;
  return Array.from({ length: 7 }, (_, index) => {
    const next = new Date(anchor);
    next.setDate(anchor.getDate() + index - 6);
    return format(next, 'yyyy-MM-dd');
  });
}

function formatAmount(value?: number, suffix = ''): string {
  if (value === undefined) return '0';
  const rounded = Math.round(value * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}${suffix}`;
}

function formatEntryTime(value: string, timezone: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown time';
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZone: timezone });
}

function confidenceLabel(value: number): string {
  return `${Math.round(value * 100)}% confidence`;
}

function componentDetails(component: FoodAnalysisDraft['components'][number] | FoodEntry['components'][number]) {
  const quantity = component.estimatedQuantity && component.estimatedUnit
    ? `${formatAmount(component.estimatedQuantity)} ${component.estimatedUnit}`
    : component.gramsEstimate
      ? `${formatAmount(component.gramsEstimate, 'g')}`
      : '';
  return [quantity, confidenceLabel(component.confidence)].filter(Boolean).join(' · ');
}

function parseWholeNumber(value: string): number {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return Number.NaN;
  return Number(trimmed);
}

function inputFormFromProfile(profile: NutritionTargetProfile | null): TargetInputForm {
  if (!profile) return TARGET_INPUT_DEFAULTS;
  return {
    ageYears: String(profile.ageYears),
    sex: profile.sex,
    weightKg: String(profile.weightKg),
    heightCm: String(profile.heightCm),
    activityLevel: profile.activityLevel,
    bodyFatRange: profile.bodyFatRange,
    goalMode: profile.goalMode,
  };
}

function reviewFormFromTargets(targets: GeneratedNutritionTargets | NutritionTargetProfile): TargetReviewForm {
  return {
    caloriesKcal: String(targets.caloriesKcal),
    proteinG: String(targets.proteinG),
    fatG: String(targets.fatG),
    carbsG: String(targets.carbsG),
    fiberG: String(targets.fiberG),
    waterMl: String(targets.waterMl),
  };
}

function inputForCalculation(form: TargetInputForm): NutritionTargetInput {
  return {
    ageYears: parseWholeNumber(form.ageYears),
    sex: form.sex,
    weightKg: Number(form.weightKg),
    heightCm: Number(form.heightCm),
    activityLevel: form.activityLevel,
    bodyFatRange: form.bodyFatRange,
    goalMode: form.goalMode,
  };
}

function targetFieldErrors(form: TargetInputForm): Partial<Record<keyof TargetInputForm, string>> {
  const errors: Partial<Record<keyof TargetInputForm, string>> = {};
  const input = inputForCalculation(form);

  for (const message of validateNutritionTargetInput(input)) {
    if (message.startsWith('ageYears')) errors.ageYears = 'Age must be 13-100.';
    if (message.startsWith('weightKg')) errors.weightKg = 'Weight must be 30-250 kg.';
    if (message.startsWith('heightCm')) errors.heightCm = 'Height must be 120-230 cm.';
    if (message.startsWith('sex')) errors.sex = 'Choose a valid sex option.';
    if (message.startsWith('activityLevel')) errors.activityLevel = 'Choose an activity level.';
    if (message.startsWith('bodyFatRange')) errors.bodyFatRange = 'Choose a body fat range.';
    if (message.startsWith('goalMode')) errors.goalMode = 'Choose a goal mode.';
  }

  return errors;
}

function reviewFieldErrors(form: TargetReviewForm): Partial<Record<keyof TargetReviewForm, string>> {
  const targets = {
    caloriesKcal: parseWholeNumber(form.caloriesKcal),
    proteinG: parseWholeNumber(form.proteinG),
    fatG: parseWholeNumber(form.fatG),
    carbsG: parseWholeNumber(form.carbsG),
    fiberG: parseWholeNumber(form.fiberG),
    waterMl: parseWholeNumber(form.waterMl),
  };
  const errors: Partial<Record<keyof TargetReviewForm, string>> = {};

  for (const message of validateNutritionTargetProfileTargets(targets)) {
    if (message.startsWith('caloriesKcal')) errors.caloriesKcal = 'Calories must be a positive whole number.';
    if (message.startsWith('proteinG')) errors.proteinG = 'Protein must be a positive whole number.';
    if (message.startsWith('fatG')) errors.fatG = 'Fat must be a positive whole number.';
    if (message.startsWith('carbsG')) errors.carbsG = 'Carbs must be a positive whole number.';
    if (message.startsWith('fiberG')) errors.fiberG = 'Fiber must be a positive whole number.';
    if (message.startsWith('waterMl')) errors.waterMl = 'Water must be 500-8000 ml.';
  }

  return errors;
}

function generateProfileId() {
  return globalThis.crypto?.randomUUID?.() ?? `nutrition-${Date.now()}`;
}

function progressPercent(consumed: number, target: number): number {
  if (target <= 0) return 0;
  return Math.min(100, Math.round((consumed / target) * 100));
}

function remainingLabel(consumed: number, target: number, unit: string): string {
  const delta = Math.round(Math.abs(target - consumed));
  return consumed <= target ? `${delta} ${unit} left` : `over by ${delta} ${unit}`;
}

function waterDisplay(valueMl: number): string {
  if (valueMl >= 1000) return `${(valueMl / 1000).toFixed(valueMl % 1000 === 0 ? 0 : 1)} L`;
  return `${valueMl} ml`;
}

function nutrientValue(nutrients: FoodNutrients, key: keyof FoodNutrients): number | undefined {
  const value = nutrients[key];
  return typeof value === 'number' ? value : undefined;
}

export default function FoodPage() {
  const { profile } = useStore();
  const foodStore = useFoodStore() as FoodStoreWithOptionalDelete;
  const {
    loading,
    error,
    loadEntriesForRange,
    saveDraftAsEntry,
    entriesForDate,
    totalsForDate,
    deleteFoodEntry,
  } = foodStore;
  const {
    targetProfile,
    loadingProfile,
    loadingWater,
    error: nutritionError,
    loadNutritionTargets,
    saveNutritionTargetProfile,
    loadWaterEntriesForRange,
    quickAddWater,
    waterTotalForDate,
  } = useNutritionTargetsStore();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [draft, setDraft] = useState<FoodAnalysisDraft | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [setupStep, setSetupStep] = useState<SetupStep>('input');
  const [editingTargets, setEditingTargets] = useState(false);
  const [inputForm, setInputForm] = useState<TargetInputForm>(TARGET_INPUT_DEFAULTS);
  const [reviewForm, setReviewForm] = useState<TargetReviewForm | null>(null);
  const [inputErrors, setInputErrors] = useState<Partial<Record<keyof TargetInputForm, string>>>({});
  const [reviewErrors, setReviewErrors] = useState<Partial<Record<keyof TargetReviewForm, string>>>({});
  const [setupMessage, setSetupMessage] = useState<string | null>(null);
  const [savingTargets, setSavingTargets] = useState(false);
  const [expandedEntryIds, setExpandedEntryIds] = useState<Set<string>>(() => new Set());
  const [confirmDeleteEntry, setConfirmDeleteEntry] = useState<FoodEntry | null>(null);

  const timezone = useMemo(() => getResolvedTimezone(profile?.timezone), [profile?.timezone]);
  const today = useMemo(() => currentDateForTimezone(timezone), [timezone]);
  const activeDate = selectedDate ?? today;
  const entries = entriesForDate(activeDate, timezone);
  const totals = totalsForDate(activeDate, timezone);
  const waterTotal = waterTotalForDate(activeDate, timezone);
  const stripDates = useMemo(() => dateStripDates(activeDate, today), [activeDate, today]);
  const shouldShowSetup = !loadingProfile && !targetProfile && !nutritionError;

  useEffect(() => {
    setSelectedDate(current => current ?? today);
  }, [today]);

  useEffect(() => {
    setExpandedEntryIds(new Set());
  }, [activeDate]);

  useEffect(() => {
    if (!profile?.id) return;
    void loadNutritionTargets(profile.id);
  }, [profile?.id, loadNutritionTargets]);

  useEffect(() => {
    if (!profile?.id) return;
    const { fromIso, toIso } = rangeAroundLocalDate(activeDate);
    void loadEntriesForRange(profile.id, fromIso, toIso);
    void loadWaterEntriesForRange(profile.id, fromIso, toIso);
  }, [profile?.id, activeDate, loadEntriesForRange, loadWaterEntriesForRange]);

  useEffect(() => {
    if (targetProfile && !editingTargets) {
      setInputForm(inputFormFromProfile(targetProfile));
      setReviewForm(reviewFormFromTargets(targetProfile));
    }
  }, [editingTargets, targetProfile]);

  async function analyzeImage(file: File) {
    setAnalyzing(true);
    setAnalysisError(null);
    setDraft(null);

    try {
      const body = new FormData();
      body.append('image', file);

      const response = await fetch('/api/food/analyze-photo', {
        method: 'POST',
        body,
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok || !payload?.draft) {
        throw new Error('analysis_failed');
      }

      setDraft(payload.draft as FoodAnalysisDraft);
    } catch {
      setAnalysisError('Unable to analyze this meal photo. Please try again.');
    } finally {
      setAnalyzing(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    void analyzeImage(file);
  }

  function handleSaveDraft() {
    if (!profile?.id || !draft) return;
    saveDraftAsEntry({
      userId: profile.id,
      timezone,
      draft,
      consumedAt: consumedAtForSelectedDateInTimezone(activeDate, timezone),
    });
    setDraft(null);
    setAnalysisError(null);
    setExpandedEntryIds(new Set());
  }

  function handleRetake() {
    setDraft(null);
    setAnalysisError(null);
    fileInputRef.current?.click();
  }

  function handleGenerateTargets() {
    const errors = targetFieldErrors(inputForm);
    setInputErrors(errors);
    setSetupMessage(null);
    if (Object.keys(errors).length > 0) return;

    try {
      const targets = calculateNutritionTargets(inputForCalculation(inputForm));
      setReviewForm(reviewFormFromTargets(targets));
      setReviewErrors({});
      setSetupStep('review');
    } catch {
      setSetupMessage('Check the fields above before calculating targets.');
    }
  }

  async function handleSaveTargets() {
    if (!profile?.id || !reviewForm) return;
    const errors = reviewFieldErrors(reviewForm);
    setReviewErrors(errors);
    setSetupMessage(null);
    if (Object.keys(errors).length > 0) return;

    const input = inputForCalculation(inputForm);
    const now = new Date().toISOString();
    const nextProfile: NutritionTargetProfile = {
      id: targetProfile?.id ?? generateProfileId(),
      userId: profile.id,
      ...input,
      caloriesKcal: parseWholeNumber(reviewForm.caloriesKcal),
      proteinG: parseWholeNumber(reviewForm.proteinG),
      fatG: parseWholeNumber(reviewForm.fatG),
      carbsG: parseWholeNumber(reviewForm.carbsG),
      fiberG: parseWholeNumber(reviewForm.fiberG),
      waterMl: parseWholeNumber(reviewForm.waterMl),
      algorithmVersion: NUTRITION_TARGET_ALGORITHM_VERSION,
      createdAt: targetProfile?.createdAt ?? now,
      updatedAt: now,
    };

    setSavingTargets(true);
    try {
      await saveNutritionTargetProfile(nextProfile);
      setEditingTargets(false);
      setSetupStep('input');
      setInputErrors({});
      setReviewErrors({});
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSetupMessage(`Targets could not be saved. ${message}`);
    } finally {
      setSavingTargets(false);
    }
  }

  function startEditingTargets() {
    setInputForm(inputFormFromProfile(targetProfile));
    setReviewForm(targetProfile ? reviewFormFromTargets(targetProfile) : null);
    setInputErrors({});
    setReviewErrors({});
    setSetupMessage(null);
    setSetupStep('input');
    setEditingTargets(true);
  }

  function cancelEditingTargets() {
    if (!targetProfile) return;
    setInputForm(inputFormFromProfile(targetProfile));
    setReviewForm(reviewFormFromTargets(targetProfile));
    setInputErrors({});
    setReviewErrors({});
    setSetupMessage(null);
    setSetupStep('input');
    setEditingTargets(false);
  }

  function toggleEntry(entryId: string) {
    setExpandedEntryIds(current => {
      const next = new Set(current);
      if (next.has(entryId)) next.delete(entryId);
      else next.add(entryId);
      return next;
    });
  }

  function confirmDelete() {
    if (!confirmDeleteEntry || !deleteFoodEntry) return;
    deleteFoodEntry(confirmDeleteEntry.id, profile?.id);
    setExpandedEntryIds(current => {
      const next = new Set(current);
      next.delete(confirmDeleteEntry.id);
      return next;
    });
    setConfirmDeleteEntry(null);
  }

  if (loadingProfile && !targetProfile) {
    return (
      <div className="flex h-full flex-col px-5 pt-2">
        <div className="rounded-2xl border border-[rgba(255,255,255,0.08)] bg-[#161B22] p-5 text-sm font-semibold text-[#8B949E]">
          Loading nutrition targets...
        </div>
      </div>
    );
  }

  if (shouldShowSetup || editingTargets) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex-shrink-0 px-5 pb-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-medium text-[#8B949E]">Nutrition targets</div>
              <h1 className="text-2xl font-extrabold text-[#F0F6FC]">{editingTargets ? 'Edit targets' : 'Food setup'}</h1>
            </div>
            {editingTargets && (
              <button
                type="button"
                onClick={cancelEditingTargets}
                className="rounded-xl bg-[#30363D] px-3 py-2 text-xs font-bold text-[#F0F6FC]"
              >
                Cancel
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 pb-5">
          {nutritionError && (
            <div className="mb-4 rounded-xl border border-[rgba(248,81,73,0.35)] bg-[rgba(248,81,73,0.1)] px-3 py-2 text-xs font-medium text-[#FCA5A5]">
              Nutrition targets could not be loaded. Complete setup to continue.
            </div>
          )}

          {setupStep === 'input' ? (
            <div className="rounded-2xl border border-[rgba(255,255,255,0.08)] bg-[#161B22] p-4">
              <div className="mb-4">
                <h2 className="text-base font-bold text-[#F0F6FC]">Body profile</h2>
                <p className="mt-1 text-xs text-[#8B949E]">Targets are calculated first, then every value can be edited before saving.</p>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <NumberField label="Age" value={inputForm.ageYears} suffix="yr" step="1" error={inputErrors.ageYears} onChange={value => setInputForm(form => ({ ...form, ageYears: value }))} />
                <NumberField label="Weight" value={inputForm.weightKg} suffix="kg" step="0.1" error={inputErrors.weightKg} onChange={value => setInputForm(form => ({ ...form, weightKg: value }))} />
                <NumberField label="Height" value={inputForm.heightCm} suffix="cm" step="0.1" error={inputErrors.heightCm} onChange={value => setInputForm(form => ({ ...form, heightCm: value }))} />
              </div>

              <div className="mt-4 space-y-3">
                <SelectField label="Sex" value={inputForm.sex} error={inputErrors.sex} onChange={value => setInputForm(form => ({ ...form, sex: value as NutritionTargetSex }))}>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="other_or_prefer_not_to_say">Other / prefer not to say</option>
                </SelectField>
                <SelectField label="Activity" value={inputForm.activityLevel} error={inputErrors.activityLevel} onChange={value => setInputForm(form => ({ ...form, activityLevel: value as NutritionActivityLevel }))}>
                  {ACTIVITY_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                </SelectField>
                <SelectField label="Body fat range" value={inputForm.bodyFatRange} error={inputErrors.bodyFatRange} onChange={value => setInputForm(form => ({ ...form, bodyFatRange: value as NutritionBodyFatRange }))}>
                  {BODY_FAT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                </SelectField>
                <SelectField label="Goal" value={inputForm.goalMode} error={inputErrors.goalMode} onChange={value => setInputForm(form => ({ ...form, goalMode: value as NutritionGoalMode }))}>
                  {GOAL_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                </SelectField>
              </div>

              {setupMessage && <InlineError message={setupMessage} />}

              <button
                type="button"
                onClick={handleGenerateTargets}
                className="mt-5 w-full rounded-xl bg-[#3B82F6] px-4 py-3 text-sm font-bold text-white"
              >
                Calculate targets
              </button>
            </div>
          ) : (
            <div className="rounded-2xl border border-[rgba(16,185,129,0.28)] bg-[rgba(16,185,129,0.08)] p-4">
              <div className="mb-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-[#10B981]">Review</div>
                <h2 className="mt-1 text-base font-bold text-[#F0F6FC]">Daily targets</h2>
                <p className="mt-1 text-xs text-[#8B949E]">Adjust any generated value before saving.</p>
              </div>

              {reviewForm && (
                <div className="grid grid-cols-2 gap-2">
                  <NumberField label="Calories" value={reviewForm.caloriesKcal} suffix="kcal" step="1" error={reviewErrors.caloriesKcal} onChange={value => setReviewForm(form => form && ({ ...form, caloriesKcal: value }))} />
                  <NumberField label="Protein" value={reviewForm.proteinG} suffix="g" step="1" error={reviewErrors.proteinG} onChange={value => setReviewForm(form => form && ({ ...form, proteinG: value }))} />
                  <NumberField label="Fat" value={reviewForm.fatG} suffix="g" step="1" error={reviewErrors.fatG} onChange={value => setReviewForm(form => form && ({ ...form, fatG: value }))} />
                  <NumberField label="Carbs" value={reviewForm.carbsG} suffix="g" step="1" error={reviewErrors.carbsG} onChange={value => setReviewForm(form => form && ({ ...form, carbsG: value }))} />
                  <NumberField label="Fiber" value={reviewForm.fiberG} suffix="g" step="1" error={reviewErrors.fiberG} onChange={value => setReviewForm(form => form && ({ ...form, fiberG: value }))} />
                  <NumberField label="Water" value={reviewForm.waterMl} suffix="ml" step="1" error={reviewErrors.waterMl} onChange={value => setReviewForm(form => form && ({ ...form, waterMl: value }))} />
                </div>
              )}

              {setupMessage && <InlineError message={setupMessage} />}

              <div className="mt-5 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setSetupStep('input')}
                  className="rounded-xl bg-[#30363D] px-4 py-3 text-sm font-bold text-[#F0F6FC]"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={handleSaveTargets}
                  disabled={savingTargets}
                  className="rounded-xl bg-[#10B981] px-4 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {savingTargets ? 'Saving...' : 'Save targets'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-shrink-0 px-5 pb-4">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <div className="text-xs font-medium text-[#8B949E]">{activeDate === today ? 'Today' : format(new Date(`${activeDate}T12:00:00`), 'EEE, MMM d')}</div>
            <h1 className="text-2xl font-extrabold text-[#F0F6FC]">Food</h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={startEditingTargets}
              className="rounded-xl bg-[#30363D] px-3 py-2 text-xs font-bold text-[#F0F6FC]"
            >
              {targetProfile ? 'Edit targets' : 'Set targets'}
            </button>
            <div className="rounded-full border border-[rgba(255,255,255,0.08)] bg-[#161B22] px-3 py-1.5 text-xs font-semibold text-[#8B949E]">
              {totals.entryCount} entries
            </div>
          </div>
        </div>

        <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
          {stripDates.map(date => (
            <button
              key={date}
              type="button"
              onClick={() => setSelectedDate(date)}
              className={[
                'min-w-[58px] rounded-xl border px-3 py-2 text-center transition-colors',
                date === activeDate
                  ? 'border-[#3B82F6] bg-[rgba(59,130,246,0.18)] text-[#F0F6FC]'
                  : 'border-[rgba(255,255,255,0.08)] bg-[#161B22] text-[#8B949E]',
              ].join(' ')}
            >
              <div className="text-[10px] font-bold uppercase">{date === today ? 'Today' : format(new Date(`${date}T12:00:00`), 'EEE')}</div>
              <div className="mt-0.5 text-sm font-extrabold">{format(new Date(`${date}T12:00:00`), 'd')}</div>
            </button>
          ))}
          {activeDate !== today && (
            <button
              type="button"
              onClick={() => setSelectedDate(today)}
              className="min-w-[74px] rounded-xl bg-[#30363D] px-3 py-2 text-xs font-bold text-[#F0F6FC]"
            >
              Today
            </button>
          )}
        </div>

        {nutritionError && (
          <div className="mb-3 rounded-xl border border-[rgba(248,81,73,0.35)] bg-[rgba(248,81,73,0.1)] px-3 py-2 text-xs font-medium text-[#FCA5A5]">
            Targets unavailable. Diary logging still works.
          </div>
        )}

        {targetProfile && (
          <>
            <div className="grid grid-cols-2 gap-2">
              {TARGET_CARDS.map(card => {
                const consumed = Math.round(Number(totals[card.totalKey] ?? 0));
                const target = targetProfile[card.key];
                return (
                  <TargetCard
                    key={card.key}
                    label={card.label}
                    unit={card.unit}
                    consumed={consumed}
                    target={target}
                  />
                );
              })}
            </div>
            <WaterTracker
              consumedMl={waterTotal}
              targetMl={targetProfile.waterMl}
              loading={loadingWater}
              onAdd={amountMl => {
                if (!profile?.id) return;
                quickAddWater({ userId: profile.id, timezone, selectedDate: activeDate, amountMl });
              }}
            />
          </>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-5">
        <div className="mb-4 rounded-2xl border border-[rgba(59,130,246,0.22)] bg-[rgba(59,130,246,0.08)] p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl bg-[rgba(59,130,246,0.16)] text-2xl">
              🍽️
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-bold text-[#F0F6FC]">Add a meal photo</div>
              <div className="mt-0.5 text-xs text-[#8B949E]">Saves to {activeDate === today ? 'today' : format(new Date(`${activeDate}T12:00:00`), 'MMM d')}</div>
            </div>
            <label className={[
              'cursor-pointer rounded-xl px-3 py-2 text-xs font-bold transition-colors',
              analyzing
                ? 'pointer-events-none bg-[#30363D] text-[#8B949E]'
                : 'bg-[#3B82F6] text-white hover:bg-[#2563EB]',
            ].join(' ')}>
              {analyzing ? 'Analyzing' : 'Capture'}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                capture="environment"
                className="sr-only"
                onChange={handleFileChange}
                disabled={analyzing}
              />
            </label>
          </div>
          {analyzing && (
            <div className="mt-4 flex items-center gap-2 text-xs font-medium text-[#8B949E]">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#3B82F6] border-t-transparent" />
              Analyzing meal photo...
            </div>
          )}
          {analysisError && (
            <div className="mt-4 rounded-xl border border-[rgba(248,81,73,0.35)] bg-[rgba(248,81,73,0.1)] px-3 py-2 text-xs font-medium text-[#FCA5A5]">
              {analysisError}
            </div>
          )}
        </div>

        {draft && (
          <div className="mb-5 rounded-2xl border border-[rgba(16,185,129,0.28)] bg-[rgba(16,185,129,0.08)] p-4">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-[#10B981]">Draft</div>
                <h2 className="mt-1 text-lg font-extrabold text-[#F0F6FC]">{draft.title}</h2>
                <p className="mt-1 text-sm text-[#C9D1D9]">{draft.summary}</p>
              </div>
              <div className="rounded-full bg-[rgba(16,185,129,0.14)] px-2.5 py-1 text-[10px] font-bold text-[#34D399]">
                {confidenceLabel(draft.estimationConfidence)}
              </div>
            </div>
            <NutrientGrid nutrients={draft.nutrients} />
            <div className="space-y-2">
              {draft.components.map((component, index) => (
                <div key={`${component.name}-${index}`} className="rounded-xl bg-[rgba(13,17,23,0.7)] px-3 py-2">
                  <div className="text-sm font-semibold text-[#F0F6FC]">{component.name}</div>
                  <div className="mt-0.5 text-xs text-[#8B949E]">{componentDetails(component)}</div>
                </div>
              ))}
            </div>
            {draft.uncertainties.length > 0 && (
              <div className="mt-3 text-xs text-[#8B949E]">
                {draft.uncertainties.join(' ')}
              </div>
            )}
            <div className="mt-4 grid grid-cols-3 gap-2">
              <button onClick={handleSaveDraft} className="rounded-xl bg-[#10B981] px-3 py-2 text-xs font-bold text-white">
                Save
              </button>
              <button onClick={handleRetake} className="rounded-xl bg-[#30363D] px-3 py-2 text-xs font-bold text-[#F0F6FC]">
                Retake
              </button>
              <button onClick={() => setDraft(null)} className="rounded-xl bg-transparent px-3 py-2 text-xs font-bold text-[#8B949E]">
                Cancel
              </button>
            </div>
          </div>
        )}

        {error && (
          <div className="mb-4 rounded-2xl border border-[rgba(248,81,73,0.35)] bg-[rgba(248,81,73,0.1)] px-4 py-3 text-sm text-[#FCA5A5]">
            Food entries could not be loaded.
          </div>
        )}

        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-bold text-[#F0F6FC]">Entries</h2>
          {loading && <div className="text-xs font-medium text-[#8B949E]">Loading...</div>}
        </div>

        {entries.length === 0 ? (
          <div className="rounded-2xl border border-[rgba(255,255,255,0.08)] bg-[#161B22] px-5 py-10 text-center">
            <div className="text-4xl">🍽️</div>
            <div className="mt-3 text-sm font-bold text-[#F0F6FC]">No food logged for this day</div>
            <div className="mt-1 text-xs text-[#8B949E]">Capture a meal photo to start this diary.</div>
          </div>
        ) : (
          <div className="space-y-3">
            {entries.map(entry => (
              <FoodEntryCard
                key={entry.id}
                entry={entry}
                timezone={timezone}
                expanded={expandedEntryIds.has(entry.id)}
                canDelete={Boolean(deleteFoodEntry)}
                onToggle={() => toggleEntry(entry.id)}
                onDelete={() => setConfirmDeleteEntry(entry)}
              />
            ))}
          </div>
        )}
      </div>

      {confirmDeleteEntry && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/60 px-5 pb-5">
          <div className="w-full max-w-[390px] rounded-2xl border border-[rgba(248,81,73,0.35)] bg-[#161B22] p-4 shadow-2xl">
            <h2 className="text-base font-bold text-[#F0F6FC]">Delete food entry?</h2>
            <p className="mt-2 text-sm text-[#8B949E]">{confirmDeleteEntry.title} will be removed from this diary.</p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteEntry(null)}
                className="rounded-xl bg-[#30363D] px-4 py-3 text-sm font-bold text-[#F0F6FC]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                className="rounded-xl bg-[#7F1D1D] px-4 py-3 text-sm font-bold text-white"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function InlineError({ message }: { message: string }) {
  return (
    <div className="mt-3 rounded-xl border border-[rgba(248,81,73,0.35)] bg-[rgba(248,81,73,0.1)] px-3 py-2 text-xs font-medium text-[#FCA5A5]">
      {message}
    </div>
  );
}

function NumberField({
  label,
  value,
  suffix,
  step,
  error,
  onChange,
}: {
  label: string;
  value: string;
  suffix: string;
  step?: string;
  error?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-bold text-[#8B949E]">{label}</span>
      <div className="flex items-center rounded-xl border border-[rgba(255,255,255,0.08)] bg-[#0D1117] px-3 py-2">
        <input
          type="number"
          inputMode="decimal"
          step={step}
          value={value}
          onChange={event => onChange(event.target.value)}
          className="min-w-0 flex-1 bg-transparent text-sm font-bold text-[#F0F6FC] outline-none"
        />
        <span className="ml-1 text-[10px] font-semibold text-[#8B949E]">{suffix}</span>
      </div>
      {error && <span className="mt-1 block text-[10px] font-medium text-[#FCA5A5]">{error}</span>}
    </label>
  );
}

function SelectField({
  label,
  value,
  error,
  onChange,
  children,
}: {
  label: string;
  value: string;
  error?: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-bold text-[#8B949E]">{label}</span>
      <select
        value={value}
        onChange={event => onChange(event.target.value)}
        className="w-full rounded-xl border border-[rgba(255,255,255,0.08)] bg-[#0D1117] px-3 py-2 text-sm font-bold text-[#F0F6FC] outline-none"
      >
        {children}
      </select>
      {error && <span className="mt-1 block text-[10px] font-medium text-[#FCA5A5]">{error}</span>}
    </label>
  );
}

function TargetCard({
  label,
  unit,
  consumed,
  target,
}: {
  label: string;
  unit: string;
  consumed: number;
  target: number;
}) {
  return (
    <div className="rounded-2xl border border-[rgba(255,255,255,0.08)] bg-[#161B22] p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="text-[11px] font-bold text-[#8B949E]">{label}</div>
        <div className="text-[10px] font-semibold text-[#8B949E]">{progressPercent(consumed, target)}%</div>
      </div>
      <div className="mt-1 text-sm font-extrabold text-[#F0F6FC]">
        {consumed.toLocaleString()} / {target.toLocaleString()} {unit}
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#0D1117]">
        <div className="h-full rounded-full bg-[#3B82F6]" style={{ width: `${progressPercent(consumed, target)}%` }} />
      </div>
      <div className="mt-1.5 text-[10px] font-semibold text-[#8B949E]">{remainingLabel(consumed, target, unit)}</div>
    </div>
  );
}

function WaterTracker({
  consumedMl,
  targetMl,
  loading,
  onAdd,
}: {
  consumedMl: number;
  targetMl: number;
  loading: boolean;
  onAdd: (amountMl: number) => void;
}) {
  return (
    <div className="mt-2 rounded-2xl border border-[rgba(56,189,248,0.24)] bg-[rgba(56,189,248,0.08)] p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className="text-sm font-bold text-[#F0F6FC]">Water</div>
            {loading && <div className="text-[10px] font-semibold text-[#8B949E]">Loading...</div>}
          </div>
          <div className="mt-1 text-xs font-semibold text-[#C9D1D9]">
            {waterDisplay(consumedMl)} / {waterDisplay(targetMl)} - {remainingLabel(consumedMl, targetMl, 'ml')}
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#0D1117]">
            <div className="h-full rounded-full bg-[#38BDF8]" style={{ width: `${progressPercent(consumedMl, targetMl)}%` }} />
          </div>
        </div>
        <div className="flex flex-shrink-0 gap-2">
          <button type="button" onClick={() => onAdd(250)} className="rounded-xl bg-[#0EA5E9] px-3 py-2 text-xs font-bold text-white">
            +250 ml
          </button>
          <button type="button" onClick={() => onAdd(500)} className="rounded-xl bg-[#0369A1] px-3 py-2 text-xs font-bold text-white">
            +500 ml
          </button>
        </div>
      </div>
    </div>
  );
}

function NutrientGrid({ nutrients }: { nutrients: FoodNutrients }) {
  return (
    <div className="mb-3 grid grid-cols-5 gap-2">
      {ENTRY_NUTRIENTS.map(item => (
        <div key={item.key} className="rounded-xl bg-[rgba(13,17,23,0.7)] p-2">
          <div className="text-sm font-bold text-[#F0F6FC]">{formatAmount(nutrientValue(nutrients, item.key), item.unit)}</div>
          <div className="mt-0.5 text-[10px] text-[#8B949E]">{item.label}</div>
        </div>
      ))}
    </div>
  );
}

function FoodEntryCard({
  entry,
  timezone,
  expanded,
  canDelete,
  onToggle,
  onDelete,
}: {
  entry: FoodEntry;
  timezone: string;
  expanded: boolean;
  canDelete: boolean;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const [swiped, setSwiped] = useState(false);
  const gesture = useRef({ pointerId: null as number | null, startX: 0, startY: 0 });

  useEffect(() => {
    setSwiped(false);
  }, [entry.id]);

  function resetGesture() {
    gesture.current = { pointerId: null, startX: 0, startY: 0 };
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return;
    gesture.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY };
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (gesture.current.pointerId !== event.pointerId) return;
    const dx = gesture.current.startX - event.clientX;
    const dy = Math.abs(gesture.current.startY - event.clientY);
    resetGesture();
    if (dy > 24 && dy > Math.abs(dx)) return;
    if (dx > 50) setSwiped(true);
    else if (dx < -30) setSwiped(false);
  }

  return (
    <div
      className="relative overflow-hidden rounded-2xl"
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={resetGesture}
      style={{ touchAction: 'pan-y' }}
    >
      <button
        type="button"
        aria-label={`Delete ${entry.title}`}
        aria-hidden={!swiped}
        tabIndex={swiped ? 0 : -1}
        disabled={!swiped}
        onClick={() => {
          onDelete();
          setSwiped(false);
        }}
        className={[
          'absolute right-0 top-0 bottom-0 w-[92px] bg-[#7F1D1D] text-[11px] font-bold text-white transition-transform duration-200',
          swiped ? 'translate-x-0' : 'translate-x-full',
        ].join(' ')}
      >
        Delete
      </button>

      <div
        className={[
          'rounded-2xl border border-[rgba(255,255,255,0.08)] bg-[#161B22] p-4 transition-all duration-200',
          swiped ? '-translate-x-[92px]' : '',
        ].join(' ')}
      >
        <div
          role="button"
          tabIndex={0}
          onClick={() => {
            if (swiped) {
              setSwiped(false);
              return;
            }
            onToggle();
          }}
          onKeyDown={event => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              if (swiped) {
                setSwiped(false);
                return;
              }
              onToggle();
            }
          }}
          className="outline-none"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold text-[#8B949E]">
                {formatEntryTime(entry.consumedAt, timezone)} · Photo · {confidenceLabel(entry.estimationConfidence)}
              </div>
              <h3 className="mt-1 truncate text-base font-extrabold text-[#F0F6FC]">{entry.title}</h3>
            </div>
            <div className="flex flex-shrink-0 items-center gap-2">
              <div className="rounded-full bg-[#0D1117] px-2.5 py-1 text-xs font-bold text-[#F0F6FC]">
                {formatAmount(entry.nutrients.caloriesKcal)} kcal
              </div>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-4 gap-2">
            {ENTRY_NUTRIENTS.filter(item => item.key !== 'caloriesKcal').map(item => (
              <div key={item.key} className="rounded-xl bg-[#0D1117] p-2">
                <div className="text-sm font-bold text-[#F0F6FC]">{formatAmount(nutrientValue(entry.nutrients, item.key), item.unit)}</div>
                <div className="mt-0.5 text-[10px] text-[#8B949E]">{item.label}</div>
              </div>
            ))}
          </div>

          {expanded && (
            <div className="mt-4 space-y-3">
              <p className="text-sm text-[#C9D1D9]">{entry.summary}</p>
              <div className="grid grid-cols-2 gap-2">
                {DETAILED_NUTRIENTS.map(item => {
                  const value = nutrientValue(entry.nutrients, item.key);
                  if (value === undefined) return null;
                  return (
                    <div key={item.key} className="rounded-xl bg-[#0D1117] px-3 py-2">
                      <div className="text-xs font-semibold text-[#8B949E]">{item.label}</div>
                      <div className="mt-0.5 text-sm font-bold text-[#F0F6FC]">{formatAmount(value, item.unit)}</div>
                    </div>
                  );
                })}
              </div>
              <div className="space-y-2">
                {entry.components.map(component => (
                  <div key={component.id} className="rounded-xl bg-[#0D1117] px-3 py-2">
                    <div className="text-sm font-semibold text-[#F0F6FC]">{component.name}</div>
                    <div className="mt-0.5 text-xs text-[#8B949E]">{componentDetails(component)}</div>
                    {component.notes && <div className="mt-1 text-xs text-[#8B949E]">{component.notes}</div>}
                  </div>
                ))}
              </div>
              {entry.uncertainties.length > 0 && (
                <div className="rounded-xl bg-[#0D1117] px-3 py-2 text-xs text-[#8B949E]">
                  {entry.uncertainties.join(' ')}
                </div>
              )}
            </div>
          )}
        </div>

        {canDelete && expanded && (
          <button
            type="button"
            onClick={onDelete}
            className="mt-3 w-full rounded-xl border border-[rgba(248,113,113,0.25)] bg-[rgba(248,113,113,0.08)] px-3 py-2 text-xs font-bold text-[#F87171]"
          >
            Delete entry
          </button>
        )}
      </div>
    </div>
  );
}
