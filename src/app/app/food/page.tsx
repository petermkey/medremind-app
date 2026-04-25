'use client';

import { type ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import { format } from 'date-fns';
import { useStore } from '@/lib/store/store';
import { useFoodStore, type FoodStoreState } from '@/lib/store/foodStore';
import type { FoodAnalysisDraft, FoodEntry } from '@/types/food';

type FoodStoreWithOptionalDelete = FoodStoreState & {
  deleteFoodEntry?: (entryId: string) => void;
};

const PRIMARY_NUTRIENTS = [
  { key: 'caloriesKcal', label: 'kcal', unit: '' },
  { key: 'proteinG', label: 'Protein', unit: 'g' },
  { key: 'carbsG', label: 'Carbs', unit: 'g' },
  { key: 'totalFatG', label: 'Fat', unit: 'g' },
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
  start.setDate(start.getDate() - 2);
  const end = new Date(`${date}T23:59:59.999`);
  end.setDate(end.getDate() + 2);
  return { fromIso: start.toISOString(), toIso: end.toISOString() };
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
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [draft, setDraft] = useState<FoodAnalysisDraft | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  const timezone = useMemo(() => getResolvedTimezone(profile?.timezone), [profile?.timezone]);
  const today = useMemo(() => currentDateForTimezone(timezone), [timezone]);
  const entries = entriesForDate(today, timezone);
  const totals = totalsForDate(today, timezone);

  useEffect(() => {
    if (!profile?.id) return;
    const { fromIso, toIso } = rangeAroundLocalDate(today);
    void loadEntriesForRange(profile.id, fromIso, toIso);
  }, [profile?.id, today, loadEntriesForRange]);

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
      consumedAt: new Date().toISOString(),
    });
    setDraft(null);
    setAnalysisError(null);
  }

  function handleRetake() {
    setDraft(null);
    setAnalysisError(null);
    fileInputRef.current?.click();
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-shrink-0 px-5 pb-4">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <div className="text-xs font-medium text-[#8B949E]">Today&apos;s diary</div>
            <h1 className="text-2xl font-extrabold text-[#F0F6FC]">Food</h1>
          </div>
          <div className="rounded-full border border-[rgba(255,255,255,0.08)] bg-[#161B22] px-3 py-1.5 text-xs font-semibold text-[#8B949E]">
            {totals.entryCount} entries
          </div>
        </div>

        <div className="grid grid-cols-4 gap-2">
          {PRIMARY_NUTRIENTS.map(item => (
            <div key={item.key} className="rounded-2xl border border-[rgba(255,255,255,0.08)] bg-[#161B22] p-3">
              <div className="text-lg font-extrabold text-[#F0F6FC]">
                {formatAmount(totals[item.key], item.unit)}
              </div>
              <div className="mt-1 text-[10px] font-semibold text-[#8B949E]">{item.label}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-5">
        <div className="mb-4 rounded-2xl border border-[rgba(59,130,246,0.22)] bg-[rgba(59,130,246,0.08)] p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl bg-[rgba(59,130,246,0.16)] text-2xl">
              🍽️
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-bold text-[#F0F6FC]">Add a meal photo</div>
              <div className="mt-0.5 text-xs text-[#8B949E]">PNG, JPEG, or WebP</div>
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
              <span className="h-4 w-4 rounded-full border-2 border-[#3B82F6] border-t-transparent animate-spin" />
              Analyzing meal photo…
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
            <div className="mb-3 grid grid-cols-4 gap-2">
              {PRIMARY_NUTRIENTS.map(item => (
                <div key={item.key} className="rounded-xl bg-[rgba(13,17,23,0.7)] p-2">
                  <div className="text-sm font-bold text-[#F0F6FC]">{formatAmount(draft.nutrients[item.key], item.unit)}</div>
                  <div className="mt-0.5 text-[10px] text-[#8B949E]">{item.label}</div>
                </div>
              ))}
            </div>
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
          {loading && <div className="text-xs font-medium text-[#8B949E]">Loading…</div>}
        </div>

        {entries.length === 0 ? (
          <div className="rounded-2xl border border-[rgba(255,255,255,0.08)] bg-[#161B22] px-5 py-10 text-center">
            <div className="text-4xl">🍽️</div>
            <div className="mt-3 text-sm font-bold text-[#F0F6FC]">No food logged today</div>
            <div className="mt-1 text-xs text-[#8B949E]">Capture a meal photo to start today&apos;s diary.</div>
          </div>
        ) : (
          <div className="space-y-3">
            {entries.map(entry => (
              <div key={entry.id} className="rounded-2xl border border-[rgba(255,255,255,0.08)] bg-[#161B22] p-4">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-[#8B949E]">
                      {formatEntryTime(entry.consumedAt, timezone)} · Photo · {confidenceLabel(entry.estimationConfidence)}
                    </div>
                    <h3 className="mt-1 text-base font-extrabold text-[#F0F6FC]">{entry.title}</h3>
                    <p className="mt-1 text-sm text-[#C9D1D9]">{entry.summary}</p>
                  </div>
                  {deleteFoodEntry && (
                    <button
                      onClick={() => deleteFoodEntry(entry.id)}
                      className="rounded-lg px-2 py-1 text-xs font-bold text-[#F87171] hover:bg-[rgba(248,113,113,0.1)]"
                    >
                      Delete
                    </button>
                  )}
                </div>
                <div className="mb-3 grid grid-cols-4 gap-2">
                  {PRIMARY_NUTRIENTS.map(item => (
                    <div key={item.key} className="rounded-xl bg-[#0D1117] p-2">
                      <div className="text-sm font-bold text-[#F0F6FC]">{formatAmount(entry.nutrients[item.key], item.unit)}</div>
                      <div className="mt-0.5 text-[10px] text-[#8B949E]">{item.label}</div>
                    </div>
                  ))}
                </div>
                <div className="space-y-2">
                  {entry.components.map(component => (
                    <div key={component.id} className="rounded-xl bg-[#0D1117] px-3 py-2">
                      <div className="text-sm font-semibold text-[#F0F6FC]">{component.name}</div>
                      <div className="mt-0.5 text-xs text-[#8B949E]">{componentDetails(component)}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
