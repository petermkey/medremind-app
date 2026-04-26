'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/Button';

type OuraStatus = {
  connected?: boolean;
  status?: string;
  lastSyncAt?: string | null;
  error?: string;
};

type MedicationStatus = {
  counts?: {
    mapItems: number;
    normalizations: number;
    rules: number;
    clinicianReviewFlags: number;
    dailyExposures: number;
  };
  lastRun?: {
    status?: string;
    updatedAt?: string | null;
    lastError?: string | null;
  } | null;
  error?: string;
};

type Consent = {
  enabled: boolean;
  includesMedicationPatterns: boolean;
  includesHealthData: boolean;
  acknowledgedNoMedChanges: boolean;
};

type CorrelationCard = {
  title: string;
  body: string;
  strength: string;
  direction: string;
  recommendationKind: string;
  r: number;
  n: number;
  generatedAt: string;
};

type CorrelationResponse = {
  consent: Consent;
  cards: CorrelationCard[];
  error?: string;
};

const DEFAULT_CONSENT: Consent = {
  enabled: false,
  includesMedicationPatterns: false,
  includesHealthData: false,
  acknowledgedNoMedChanges: false,
};

export default function InsightsPage() {
  const [oura, setOura] = useState<OuraStatus | null>(null);
  const [healthSync, setHealthSync] = useState<string>('Not synced in this session');
  const [medicationStatus, setMedicationStatus] = useState<MedicationStatus | null>(null);
  const [correlations, setCorrelations] = useState<CorrelationResponse>({ consent: DEFAULT_CONSENT, cards: [] });
  const [loading, setLoading] = useState(true);
  const [refreshingHealth, setRefreshingHealth] = useState(false);
  const [refreshingMedication, setRefreshingMedication] = useState(false);
  const [refreshingCorrelations, setRefreshingCorrelations] = useState(false);
  const [message, setMessage] = useState('');

  const consentReady = useMemo(() => (
    correlations.consent.enabled
    && correlations.consent.includesMedicationPatterns
    && correlations.consent.includesHealthData
    && correlations.consent.acknowledgedNoMedChanges
  ), [correlations.consent]);

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      fetch('/api/integrations/oura/status').then((response) => response.json()).catch(() => ({ error: 'Oura status unavailable.' })),
      fetch('/api/medication-knowledge/status').then((response) => response.json()).catch(() => ({ error: 'Medication knowledge unavailable.' })),
      fetch('/api/insights/correlations').then((response) => response.json()).catch(() => ({ consent: DEFAULT_CONSENT, cards: [], error: 'Insights unavailable.' })),
    ]).then(([ouraData, medicationData, correlationData]) => {
      if (cancelled) return;
      setOura(ouraData);
      setMedicationStatus(medicationData);
      setCorrelations({
        consent: correlationData.consent ?? DEFAULT_CONSENT,
        cards: correlationData.cards ?? [],
        error: correlationData.error,
      });
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  async function saveConsent(nextConsent: Consent) {
    setMessage('');
    const response = await fetch('/api/insights/correlations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ consent: nextConsent, refresh: false }),
    });
    const data = await response.json();
    setCorrelations({
      consent: data.consent ?? nextConsent,
      cards: data.cards ?? [],
      error: response.ok ? undefined : data.error,
    });
    if (!response.ok) setMessage(data.error ?? 'Consent update failed.');
  }

  async function refreshCorrelations() {
    setRefreshingCorrelations(true);
    setMessage('');
    try {
      const response = await fetch('/api/insights/correlations', { method: 'POST' });
      const data = await response.json();
      setCorrelations({
        consent: data.consent ?? correlations.consent,
        cards: data.cards ?? [],
        error: response.ok ? undefined : data.error,
      });
      setMessage(response.ok ? 'Insights refreshed.' : data.error ?? 'Insights refresh failed.');
    } finally {
      setRefreshingCorrelations(false);
    }
  }

  async function syncHealth() {
    setRefreshingHealth(true);
    try {
      const response = await fetch('/api/integrations/health/sync', { method: 'POST' });
      const data = await response.json();
      setHealthSync(response.ok ? `Synced ${data.counts?.oura ?? 0} Oura day(s).` : data.error ?? 'Health sync failed.');
    } finally {
      setRefreshingHealth(false);
    }
  }

  async function refreshMedicationKnowledge() {
    setRefreshingMedication(true);
    try {
      const response = await fetch('/api/medication-knowledge/refresh', { method: 'POST' });
      const data = await response.json();
      setMedicationStatus((current) => ({
        ...current,
        counts: {
          mapItems: data.counts?.mapItems ?? current?.counts?.mapItems ?? 0,
          normalizations: data.counts?.normalizations ?? current?.counts?.normalizations ?? 0,
          rules: data.counts?.rules ?? current?.counts?.rules ?? 0,
          clinicianReviewFlags: current?.counts?.clinicianReviewFlags ?? 0,
          dailyExposures: data.counts?.dailyExposures ?? current?.counts?.dailyExposures ?? 0,
        },
        lastRun: data.lastRun ?? current?.lastRun ?? null,
        error: response.ok ? undefined : data.error,
      }));
      setMessage(response.ok ? 'Medication knowledge refreshed.' : data.error ?? 'Medication knowledge refresh failed.');
    } finally {
      setRefreshingMedication(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-shrink-0 px-5 pt-4 pb-3">
        <h1 className="text-xl font-extrabold text-[#F0F6FC]">Insights</h1>
        <p className="mt-1 text-xs leading-relaxed text-[#8B949E]">
          Private pattern summaries for adherence, medication context, food, and connected health data.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-8">
        {loading ? (
          <p className="text-sm text-[#8B949E]">Loading insights...</p>
        ) : (
          <div className="flex flex-col gap-5">
            <div className="grid gap-3">
              <StatusCard
                title="Oura"
                value={oura?.connected ? 'Connected' : 'Not connected'}
                detail={oura?.lastSyncAt ? `Last sync: ${new Date(oura.lastSyncAt).toLocaleString()}` : oura?.error ?? 'Connection status only.'}
                action={<a className="text-xs font-semibold text-[#3B82F6]" href="/api/integrations/oura/connect">Connect</a>}
              />
              <StatusCard
                title="Health sync"
                value={healthSync}
                detail="Sync imports daily health summaries only."
                action={<Button size="sm" variant="secondary" onClick={syncHealth} loading={refreshingHealth}>Sync</Button>}
              />
              <StatusCard
                title="Medication knowledge"
                value={`${medicationStatus?.counts?.mapItems ?? 0} active map item(s)`}
                detail={`${medicationStatus?.counts?.rules ?? 0} rule card(s), ${medicationStatus?.counts?.clinicianReviewFlags ?? 0} clinician-review flag(s).`}
                action={<Button size="sm" variant="secondary" onClick={refreshMedicationKnowledge} loading={refreshingMedication}>Refresh</Button>}
              />
            </div>

            <Section title="Analysis Consent">
              <ConsentToggle
                label="Medication pattern analysis"
                checked={correlations.consent.enabled && correlations.consent.includesMedicationPatterns}
                onChange={(checked) => saveConsent({
                  ...correlations.consent,
                  enabled: checked || correlations.consent.includesHealthData,
                  includesMedicationPatterns: checked,
                })}
              />
              <ConsentToggle
                label="Health-data analysis"
                checked={correlations.consent.enabled && correlations.consent.includesHealthData}
                onChange={(checked) => saveConsent({
                  ...correlations.consent,
                  enabled: checked || correlations.consent.includesMedicationPatterns,
                  includesHealthData: checked,
                })}
              />
              <ConsentToggle
                label="I understand insights support clinician review and do not change medication instructions."
                checked={correlations.consent.acknowledgedNoMedChanges}
                onChange={(checked) => saveConsent({
                  ...correlations.consent,
                  enabled: checked || correlations.consent.enabled,
                  acknowledgedNoMedChanges: checked,
                })}
              />
              <Button size="sm" onClick={refreshCorrelations} loading={refreshingCorrelations} disabled={!consentReady}>
                Refresh correlation insights
              </Button>
              {message && <p className="text-xs text-[#8B949E]">{message}</p>}
              {correlations.error && <p className="text-xs text-[#FCA5A5]">{correlations.error}</p>}
            </Section>

            <Section title="Correlation Cards">
              {correlations.cards.length === 0 ? (
                <p className="text-sm text-[#8B949E]">
                  No correlation cards yet. Enable consent and refresh after health, food, and medication summaries are available.
                </p>
              ) : correlations.cards.map((card) => (
                <article key={`${card.title}-${card.generatedAt}`} className="rounded-xl border border-[rgba(255,255,255,0.08)] bg-[#0D1117] p-4">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <h2 className="text-sm font-bold text-[#F0F6FC]">{card.title}</h2>
                    <span className="rounded-full bg-[rgba(59,130,246,0.12)] px-2 py-1 text-[10px] font-bold uppercase text-[#93C5FD]">
                      {card.strength}
                    </span>
                  </div>
                  <p className="text-sm leading-relaxed text-[#C9D1D9]">{card.body}</p>
                  <p className="mt-3 text-xs text-[#8B949E]">
                    Direction: {card.direction} · r {card.r.toFixed(2)} · paired days {card.n}
                  </p>
                </article>
              ))}
            </Section>

            <Link href="/app/insights/medications" className="text-sm font-semibold text-[#3B82F6]">
              View medication-specific insights
            </Link>
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

function StatusCard({ title, value, detail, action }: { title: string; value: string; detail: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-[rgba(255,255,255,0.08)] bg-[#161B22] p-4">
      <div className="min-w-0">
        <div className="text-xs font-bold uppercase tracking-widest text-[#8B949E]">{title}</div>
        <div className="mt-1 text-sm font-semibold text-[#F0F6FC]">{value}</div>
        <div className="mt-1 text-xs leading-relaxed text-[#8B949E]">{detail}</div>
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  );
}

function ConsentToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex items-center justify-between gap-3 text-left"
    >
      <span className="text-sm font-semibold leading-relaxed text-[#F0F6FC]">{label}</span>
      <span className={`relative h-6 w-12 flex-shrink-0 rounded-full transition-colors ${checked ? 'bg-[#3B82F6]' : 'bg-[#1C2333]'}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${checked ? 'left-6' : 'left-0.5'}`} />
      </span>
    </button>
  );
}
