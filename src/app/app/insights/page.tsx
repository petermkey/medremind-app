'use client';

import { useEffect, useMemo } from 'react';
import { format, subDays } from 'date-fns';
import { useFoodStore } from '@/lib/store/foodStore';
import { useNutritionTargetsStore } from '@/lib/store/nutritionTargetsStore';
import { useStore } from '@/lib/store/store';

function progressPercent(consumed: number, target: number): number {
  if (target <= 0) return 0;
  return Math.min(100, Math.round((consumed / target) * 100));
}

function pctToColor(pct: number) {
  if (pct === 0) return '#1C2333';
  if (pct < 50) return '#EF4444';
  if (pct < 80) return '#FBBF24';
  return '#10B981';
}

function formatAmount(value?: number): string {
  if (value === undefined) return '0';
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1);
}

function waterDisplay(valueMl: number): string {
  if (valueMl >= 1000) return `${(valueMl / 1000).toFixed(valueMl % 1000 === 0 ? 0 : 1)} L`;
  return `${valueMl} ml`;
}

function getResolvedTimezone(timezone?: string): string {
  function isValidTimezoneCandidate(candidate?: string): candidate is string {
    if (!candidate?.trim()) return false;
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: candidate });
      return true;
    } catch {
      return false;
    }
  }

  const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const candidates = [timezone?.trim(), browserTimezone?.trim()];
  return candidates.find(isValidTimezoneCandidate) ?? 'UTC';
}

export default function InsightsPage() {
  const { profile } = useStore();
  const { loadEntriesForRange, totalsForDate } = useFoodStore();
  const { targetProfile, loadNutritionTargets, loadWaterEntriesForRange, waterTotalForDate } =
    useNutritionTargetsStore();

  const timezone = useMemo(() => getResolvedTimezone(profile?.timezone), [profile?.timezone]);

  useEffect(() => {
    if (!profile?.id) return;
    void loadNutritionTargets(profile.id);
  }, [profile?.id, loadNutritionTargets]);

  useEffect(() => {
    if (!profile?.id) return;
    const now = new Date();
    const start = subDays(now, 8);
    const fromIso = start.toISOString();
    const toIso = new Date(now.getTime() + 86400000).toISOString();
    void loadEntriesForRange(profile.id, fromIso, toIso);
    void loadWaterEntriesForRange(profile.id, fromIso, toIso);
  }, [profile?.id, loadEntriesForRange, loadWaterEntriesForRange]);

  const sevenDayData = useMemo(() => {
    const today = new Date();
    const dates = Array.from({ length: 7 }, (_, i) => {
      const d = subDays(today, 6 - i);
      return format(d, 'yyyy-MM-dd');
    });

    let totalKcal = 0;
    let totalProtein = 0;
    let totalFiber = 0;
    let totalWater = 0;
    let entryCount = 0;

    for (const date of dates) {
      const dayTotals = totalsForDate(date, timezone);
      if (dayTotals.entryCount > 0) {
        entryCount += dayTotals.entryCount;
        totalKcal += dayTotals.caloriesKcal ?? 0;
        totalProtein += dayTotals.proteinG ?? 0;
        totalFiber += dayTotals.fiberG ?? 0;
      }
      const waterTotal = waterTotalForDate(date, timezone);
      totalWater += waterTotal;
    }

    return {
      dates,
      avgKcal: entryCount > 0 ? totalKcal / 7 : 0,
      avgProtein: entryCount > 0 ? totalProtein / 7 : 0,
      avgFiber: entryCount > 0 ? totalFiber / 7 : 0,
      avgWater: totalWater / 7,
      hasEntries: entryCount > 0,
    };
  }, [totalsForDate, waterTotalForDate, timezone]);

  if (!targetProfile || !sevenDayData.hasEntries) {
    return (
      <div className="flex flex-col h-full">
        <div className="px-5 pt-4 pb-2 flex-shrink-0">
          <h1 className="text-xl font-extrabold text-[#F0F6FC]">Insights</h1>
        </div>
        <div className="flex-1 overflow-y-auto px-5 pb-6 flex items-center justify-center">
          <div className="text-center">
            <div className="text-4xl mb-3">📊</div>
            <div className="text-sm font-bold text-[#F0F6FC] mb-1">No nutrition data yet</div>
            <div className="text-xs text-[#8B949E]">Log a meal to see your 7-day summary.</div>
          </div>
        </div>
      </div>
    );
  }

  const kcalPercent = progressPercent(sevenDayData.avgKcal, targetProfile.caloriesKcal);
  const proteinPercent = progressPercent(sevenDayData.avgProtein, targetProfile.proteinG);
  const fiberPercent = progressPercent(sevenDayData.avgFiber, targetProfile.fiberG);
  const waterPercent = progressPercent(sevenDayData.avgWater, targetProfile.waterMl);

  return (
    <div className="flex flex-col h-full">
      <div className="px-5 pt-4 pb-2 flex-shrink-0">
        <h1 className="text-xl font-extrabold text-[#F0F6FC]">Insights</h1>
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-6">
        {/* 7-Day Nutrition Summary Card */}
        <div className="bg-[#161B22] border border-[rgba(255,255,255,0.08)] rounded-2xl p-4 mb-4 mt-3">
          <div className="text-xs font-bold text-[#8B949E] uppercase tracking-widest mb-4">7-Day Average</div>

          <div className="space-y-4">
            {/* Calories */}
            <div>
              <div className="flex justify-between mb-1.5">
                <span className="text-sm font-semibold text-[#F0F6FC]">Calories</span>
                <span className="text-sm font-bold" style={{ color: pctToColor(kcalPercent) }}>
                  {formatAmount(sevenDayData.avgKcal)} / {targetProfile.caloriesKcal} kcal
                </span>
              </div>
              <div className="h-2 bg-[#1C2333] rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${kcalPercent}%`, background: pctToColor(kcalPercent) }}
                />
              </div>
            </div>

            {/* Protein */}
            <div>
              <div className="flex justify-between mb-1.5">
                <span className="text-sm font-semibold text-[#F0F6FC]">Protein</span>
                <span className="text-sm font-bold" style={{ color: pctToColor(proteinPercent) }}>
                  {formatAmount(sevenDayData.avgProtein)} / {targetProfile.proteinG} g
                </span>
              </div>
              <div className="h-2 bg-[#1C2333] rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${proteinPercent}%`, background: pctToColor(proteinPercent) }}
                />
              </div>
            </div>

            {/* Fiber */}
            <div>
              <div className="flex justify-between mb-1.5">
                <span className="text-sm font-semibold text-[#F0F6FC]">Fiber</span>
                <span className="text-sm font-bold" style={{ color: pctToColor(fiberPercent) }}>
                  {formatAmount(sevenDayData.avgFiber)} / {targetProfile.fiberG} g
                </span>
              </div>
              <div className="h-2 bg-[#1C2333] rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${fiberPercent}%`, background: pctToColor(fiberPercent) }}
                />
              </div>
            </div>

            {/* Water */}
            <div>
              <div className="flex justify-between mb-1.5">
                <span className="text-sm font-semibold text-[#F0F6FC]">Water</span>
                <span className="text-sm font-bold" style={{ color: pctToColor(waterPercent) }}>
                  {waterDisplay(sevenDayData.avgWater)} / {waterDisplay(targetProfile.waterMl)}
                </span>
              </div>
              <div className="h-2 bg-[#1C2333] rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${waterPercent}%`, background: pctToColor(waterPercent) }}
                />
              </div>
            </div>
          </div>

          <div className="text-[11px] text-[#8B949E] mt-4">
            Based on logged entries from the last 7 days
          </div>
        </div>
      </div>
    </div>
  );
}
