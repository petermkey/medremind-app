'use client';
import { useEffect, useState } from 'react';

type Contributor = { displayName: string; amountPerDay: number; validationStatus: string };
type Finding = {
  nutrientKey: string;
  label: string;
  unit: string;
  foodAvgPerDay: number;
  stackPerDay: number;
  totalPerDay: number;
  target: number | null;
  ul: number | null;
  ulScope: 'total' | 'supplemental';
  pctOfTarget: number | null;
  contributors: Contributor[];
  unverified: boolean;
};
type BalanceResponse = {
  report: { version: string; buckets: { deficits: Finding[]; covered: Finding[]; excess: Finding[] } };
  pendingItems: string[];
  loggedDays: number;
  insufficientFoodData: boolean;
  limitsVersion: string;
};

const BUCKETS = [
  { key: 'deficits', title: 'Deficits', color: '#c96a5a', hint: 'Food + stack below target' },
  { key: 'covered', title: 'Covered / redundant', color: '#8fae74', hint: 'Diet already supplies this' },
  { key: 'excess', title: 'Possible excess', color: '#cf8148', hint: 'Approaching the curated upper limit' },
] as const;

const DISCLAIMER =
  'These patterns support clinician review and are not medical advice. Do not start, stop, or change any medication or supplement based on this card.';

function formatAmount(value: number, unit: string): string {
  const rounded = Math.round(value * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)} ${unit}`;
}

export function NutrientBalanceCard() {
  const [data, setData] = useState<BalanceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  async function load(refresh: boolean) {
    if (refresh) setRefreshing(true);
    setError(null);
    try {
      const response = await fetch(`/api/insights/nutrient-balance${refresh ? '?refresh=1' : ''}`);
      const payload = await response.json().catch(() => null) as BalanceResponse | null;
      if (!response.ok || !payload?.report) {
        setError('Nutrient balance is unavailable right now.');
        return;
      }
      setData(payload);
    } catch {
      setError('Nutrient balance is unavailable right now.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void load(false);
  }, []);

  const totalFindings = data
    ? data.report.buckets.deficits.length +
      data.report.buckets.covered.length +
      data.report.buckets.excess.length
    : 0;

  return (
    <div className="bg-[#14171b] border border-[rgba(255,255,255,0.08)] rounded-2xl p-4 mb-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <div className="text-xs font-bold text-[#9b978f] uppercase tracking-widest">Nutrient Balance</div>
          <div className="mt-1 text-xs leading-relaxed text-[#9b978f]">
            Food diary 14-day average crossed with the active supplement stack.
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load(true)}
          disabled={refreshing}
          className="rounded-xl bg-[#23272d] px-3 py-1.5 text-xs font-bold text-[#e8e6e1] disabled:opacity-60"
        >
          {refreshing ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {loading && <p className="text-sm text-[#9b978f]">Loading nutrient balance...</p>}
      {error && <p className="text-xs text-[#e2a89d]">{error}</p>}

      {data && !loading && (
        <div className="flex flex-col gap-3">
          {data.insufficientFoodData && (
            <p className="rounded-xl bg-[#0e1013] px-3 py-2 text-xs text-[#9b978f]">
              Only {data.loggedDays} day(s) of food logged in the last 14. Log at least 3 days
              for reliable deficit math.
            </p>
          )}
          {totalFindings === 0 && !data.insufficientFoodData && (
            <p className="text-sm leading-relaxed text-[#9b978f]">
              No findings yet. Log meals and refresh medication context above so the stack is
              known, then refresh.
            </p>
          )}

          {BUCKETS.map(bucket => {
            const findings = data.report.buckets[bucket.key];
            if (findings.length === 0) return null;
            return (
              <div key={bucket.key}>
                <div className="mb-1.5 flex items-baseline gap-2">
                  <span className="text-sm font-bold" style={{ color: bucket.color }}>
                    {bucket.title}
                  </span>
                  <span className="text-[10px] text-[#9b978f]">{bucket.hint}</span>
                </div>
                <div className="space-y-1.5">
                  {findings.map(finding => {
                    const rowKey = `${bucket.key}:${finding.nutrientKey}`;
                    const expanded = expandedKey === rowKey;
                    return (
                      <div key={rowKey} className="rounded-xl bg-[#0e1013]">
                        <button
                          type="button"
                          onClick={() => setExpandedKey(expanded ? null : rowKey)}
                          className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
                        >
                          <span className="flex items-center gap-2 text-sm font-semibold text-[#e8e6e1]">
                            {finding.label}
                            {finding.unverified && (
                              <span className="rounded-full bg-[rgba(207,129,72,0.16)] px-2 py-0.5 text-[9px] font-bold text-[#cf8148]">
                                unverified
                              </span>
                            )}
                          </span>
                          <span className="text-xs font-bold text-[#9b978f]">
                            {formatAmount(finding.totalPerDay, finding.unit)}
                            {finding.target !== null && ` / ${formatAmount(finding.target, finding.unit)}`}
                          </span>
                        </button>
                        {expanded && (
                          <div className="border-t border-[rgba(255,255,255,0.06)] px-3 py-2 text-xs text-[#9b978f]">
                            <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                              <span>Food avg/day</span>
                              <span className="text-right text-[#c4c0b8]">{formatAmount(finding.foodAvgPerDay, finding.unit)}</span>
                              <span>Stack/day</span>
                              <span className="text-right text-[#c4c0b8]">{formatAmount(finding.stackPerDay, finding.unit)}</span>
                              <span>Target</span>
                              <span className="text-right text-[#c4c0b8]">
                                {finding.target !== null ? formatAmount(finding.target, finding.unit) : '-'}
                              </span>
                              <span>Upper limit{finding.ulScope === 'supplemental' ? ' (supplemental)' : ''}</span>
                              <span className="text-right text-[#c4c0b8]">
                                {finding.ul !== null ? formatAmount(finding.ul, finding.unit) : '-'}
                              </span>
                            </div>
                            {finding.contributors.length > 0 && (
                              <div className="mt-2">
                                <div className="font-semibold text-[#c4c0b8]">Stack contribution</div>
                                {finding.contributors.map(contributor => (
                                  <div key={contributor.displayName} className="mt-0.5 flex justify-between gap-2">
                                    <span>
                                      {contributor.displayName}
                                      {contributor.validationStatus !== 'verified' && ' (unverified)'}
                                    </span>
                                    <span>{formatAmount(contributor.amountPerDay, finding.unit)}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {data.pendingItems.length > 0 && (
            <p className="rounded-xl bg-[#0e1013] px-3 py-2 text-[11px] text-[#9b978f]">
              Awaiting nutrient facts (unverified): {data.pendingItems.join(', ')}. Refresh
              later to extract.
            </p>
          )}
          <p className="text-[10px] leading-relaxed text-[#9b978f]">{DISCLAIMER}</p>
        </div>
      )}
    </div>
  );
}
