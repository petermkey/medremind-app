'use client';

import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/Button';

type MedicationSummary = {
  id: string;
  displayName: string;
  genericName: string | null;
  doseLabel: string | null;
  route: string | null;
  frequencyType: string | null;
  status: string;
  startDate: string | null;
  endDate: string | null;
};

type ClassSummary = {
  label: string;
  count: number;
};

type RuleSummary = {
  id: string;
  medicationMapItemId: string;
  ruleId: string;
  domain: string;
  recommendationKind: string;
  riskLevel: string;
  title: string;
  body: string;
  evidenceLabels: string[];
};

type MedicationKnowledgeStatus = {
  counts: {
    mapItems: number;
    normalizations: number;
    rules: number;
    clinicianReviewFlags: number;
    dailyExposures: number;
  };
  lastRun: {
    status?: string;
    updatedAt?: string | null;
    lastError?: string | null;
  } | null;
  activeMedications: MedicationSummary[];
  matchedClasses: ClassSummary[];
  lifestyleRules: RuleSummary[];
  latestExposure: {
    localDate?: string;
    medicationClassExposureScore?: number;
    medicationReviewSignalCount?: number;
    updatedAt?: string;
  } | null;
  error?: string;
};

export default function MedicationInsightsPage() {
  const [status, setStatus] = useState<MedicationKnowledgeStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState('');

  async function loadStatus() {
    const response = await fetch('/api/medication-knowledge/status');
    const data = await response.json();
    setStatus(data);
  }

  useEffect(() => {
    let cancelled = false;
    loadStatus()
      .catch(() => {
        if (!cancelled) setStatus({ error: 'Medication insights unavailable.' } as MedicationKnowledgeStatus);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function refresh() {
    setRefreshing(true);
    setMessage('');
    try {
      const response = await fetch('/api/medication-knowledge/refresh', { method: 'POST' });
      const data = await response.json();
      setMessage(response.ok ? 'Medication knowledge refreshed.' : data.error ?? 'Medication knowledge refresh failed.');
      await loadStatus();
    } finally {
      setRefreshing(false);
    }
  }

  const clinicianFlags = status?.lifestyleRules?.filter((rule) => rule.recommendationKind === 'clinician_review') ?? [];

  return (
    <div className="flex h-full flex-col">
      <div className="flex-shrink-0 px-5 pt-4 pb-3">
        <h1 className="text-xl font-extrabold text-[#F0F6FC]">Medication Insights</h1>
        <p className="mt-1 text-xs leading-relaxed text-[#8B949E]">
          Medication context for pattern tracking and clinician-review conversations.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-8">
        {loading ? (
          <p className="text-sm text-[#8B949E]">Loading medication insights...</p>
        ) : (
          <div className="flex flex-col gap-5">
            <div className="flex items-center justify-between gap-3 rounded-2xl border border-[rgba(255,255,255,0.08)] bg-[#161B22] p-4">
              <div>
                <div className="text-sm font-semibold text-[#F0F6FC]">
                  {status?.counts?.mapItems ?? 0} active medication map item(s)
                </div>
                <div className="mt-1 text-xs text-[#8B949E]">
                  Last run: {status?.lastRun?.updatedAt ? new Date(status.lastRun.updatedAt).toLocaleString() : 'Not run yet'}
                </div>
              </div>
              <Button size="sm" variant="secondary" onClick={refresh} loading={refreshing}>Refresh</Button>
            </div>

            {message && <p className="text-xs text-[#8B949E]">{message}</p>}
            {status?.error && <p className="text-xs text-[#FCA5A5]">{status.error}</p>}

            <Section title="Active Medication Map">
              {status?.activeMedications?.length ? status.activeMedications.map((item) => (
                <div key={item.id} className="rounded-xl border border-[rgba(255,255,255,0.08)] bg-[#0D1117] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="text-sm font-bold text-[#F0F6FC]">{item.displayName}</h2>
                      <p className="mt-1 text-xs text-[#8B949E]">
                        {[item.genericName, item.doseLabel, item.route, item.frequencyType].filter(Boolean).join(' · ') || 'Medication item'}
                      </p>
                    </div>
                    <span className="rounded-full bg-[rgba(16,185,129,0.12)] px-2 py-1 text-[10px] font-bold uppercase text-[#86EFAC]">
                      {item.status}
                    </span>
                  </div>
                </div>
              )) : (
                <p className="text-sm text-[#8B949E]">No medication map items are available yet.</p>
              )}
            </Section>

            <Section title="Matched Classes">
              {status?.matchedClasses?.length ? (
                <div className="flex flex-wrap gap-2">
                  {status.matchedClasses.map((item) => (
                    <span key={item.label} className="rounded-full bg-[rgba(59,130,246,0.12)] px-3 py-1 text-xs font-semibold text-[#93C5FD]">
                      {item.label} · {item.count}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-[#8B949E]">No deterministic medication classes matched yet.</p>
              )}
            </Section>

            <Section title="Lifestyle Rule Cards">
              {status?.lifestyleRules?.length ? status.lifestyleRules.map((rule) => (
                <article key={rule.id} className="rounded-xl border border-[rgba(255,255,255,0.08)] bg-[#0D1117] p-4">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <h2 className="text-sm font-bold text-[#F0F6FC]">{rule.title}</h2>
                    <span className="rounded-full bg-[rgba(255,255,255,0.06)] px-2 py-1 text-[10px] font-bold uppercase text-[#C9D1D9]">
                      {rule.domain}
                    </span>
                  </div>
                  <p className="text-sm leading-relaxed text-[#C9D1D9]">{rule.body}</p>
                  <p className="mt-3 text-xs text-[#8B949E]">
                    Evidence: {rule.evidenceLabels.length ? rule.evidenceLabels.join(', ') : 'Curated rule'}
                  </p>
                </article>
              )) : (
                <p className="text-sm text-[#8B949E]">No lifestyle rule cards are available yet.</p>
              )}
            </Section>

            <Section title="Clinician-Review Flags">
              {clinicianFlags.length ? clinicianFlags.map((rule) => (
                <div key={rule.id} className="rounded-xl border border-[rgba(251,191,36,0.25)] bg-[rgba(251,191,36,0.08)] p-4">
                  <h2 className="text-sm font-bold text-[#FDE68A]">{rule.title}</h2>
                  <p className="mt-2 text-sm leading-relaxed text-[#F0F6FC]">{rule.body}</p>
                  <p className="mt-3 text-xs text-[#8B949E]">Use this as a clinician-review discussion prompt.</p>
                </div>
              )) : (
                <p className="text-sm text-[#8B949E]">No clinician-review flags are active.</p>
              )}
            </Section>
          </div>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-3 text-xs font-bold uppercase tracking-widest text-[#8B949E]">{title}</div>
      <div className="flex flex-col gap-3 rounded-2xl border border-[rgba(255,255,255,0.08)] bg-[#161B22] p-4">
        {children}
      </div>
    </section>
  );
}
