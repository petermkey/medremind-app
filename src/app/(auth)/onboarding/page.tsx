'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useStore } from '@/lib/store/store';
import { saveProfile } from '@/lib/supabase/auth';
import { subscribeToPush } from '@/lib/push/subscription';
import { useInstallState } from '@/lib/push/useInstallState';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import type { AgeRange, ProtocolCategory } from '@/types';

const CATEGORY_LABELS: Record<ProtocolCategory, string> = {
  general: 'General Health',
  cardiovascular: 'Cardiovascular',
  metabolic: 'Metabolic',
  hormonal: 'Hormonal',
  neurological: 'Neurological',
  immune: 'Immune',
  custom: 'Custom',
};

export default function OnboardingPage() {
  const router = useRouter();
  const { profile, completeOnboarding, protocols, activateProtocol } = useStore();
  const [step, setStep] = useState(1);

  // Step 1 state
  const [name, setName] = useState(profile?.name ?? '');
  const [timezone, setTimezone] = useState('UTC');
  const [ageRange, setAgeRange] = useState<AgeRange>(profile?.ageRange ?? '31-50');
  const profileSyncedRef = useRef(false);

  // Step 2 state
  const [selectedProtocolId, setSelectedProtocolId] = useState<string | null>(null);

  // Step 3 state
  const [morningTime, setMorningTime] = useState('08:00');
  const [afternoonTime, setAfternoonTime] = useState('13:00');
  const [eveningTime, setEveningTime] = useState('21:00');

  const templates = protocols.filter(p => p.isTemplate);
  const installState = useInstallState();

  useEffect(() => {
    setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  }, []);

  // The persisted store hydrates from localStorage after this component's
  // first render, so the useState initializers above can miss an
  // already-known profile. Backfill once hydration lands, without
  // clobbering anything the user has already typed.
  useEffect(() => {
    if (profileSyncedRef.current || !profile) return;
    profileSyncedRef.current = true;
    if (profile.name) setName(prev => prev || profile.name);
    if (profile.ageRange) setAgeRange(profile.ageRange);
  }, [profile]);

  function handleStep1() {
    if (!name.trim()) return;
    setStep(2);
  }

  function handleStep2(skip = false) {
    if (!skip && selectedProtocolId) {
      // Protocol will be activated at the end
    }
    setStep(3);
  }

  async function handleFinish() {
    const patch = { name: name.trim(), timezone, ageRange };
    completeOnboarding(patch);

    if (selectedProtocolId) {
      const today = new Date().toISOString().slice(0, 10);
      activateProtocol(selectedProtocolId, today);
    }

    // Persist to Supabase — non-blocking
    const p = useStore.getState().profile;
    if (p) saveProfile({ ...p, ...patch, onboarded: true }).catch(() => {});

    // Attempt push subscription if running as installed Home Screen PWA.
    // This is a best-effort call from a user gesture (button click).
    // Failure here is non-blocking — user can enable push in Settings later.
    if (installState === 'standalone') {
      subscribeToPush().catch(() => {});
    }

    router.push('/app');
  }

  const stepLabels = ['Profile', 'Protocol', 'Reminders'];

  return (
    <div className="min-h-screen bg-[var(--bg)] flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="flex items-center gap-3 justify-center mb-8">
          <div className="w-10 h-10 rounded-xl bg-[var(--surface)] border border-[var(--border)] flex items-center justify-center text-xl">💊</div>
          <span className="text-xl font-bold text-[var(--text)] tracking-tight">MedRemind</span>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-2 mb-8">
          {stepLabels.map((label, i) => (
            <div key={label} className="flex items-center gap-2 flex-1">
              <div className={[
                'w-7 h-7 rounded-full flex items-center justify-center text-xs font-mono font-bold tabular-nums flex-shrink-0 border',
                i + 1 < step ? 'bg-[var(--green)] border-[var(--green)] text-[var(--blue-on)]' : i + 1 === step ? 'bg-[var(--blue)] border-[var(--blue)] text-[var(--blue-on)]' : 'bg-[var(--surface2)] border-[var(--border)] text-[var(--muted)]',
              ].join(' ')}>
                {i + 1 < step ? '✓' : i + 1}
              </div>
              <span className={`text-[10px] font-mono uppercase tracking-wider whitespace-nowrap ${i + 1 === step ? 'text-[var(--text)]' : 'text-[var(--muted)]'}`}>{label}</span>
              {i < 2 && <div className="flex-1 h-px bg-[var(--border)]" />}
            </div>
          ))}
        </div>

        {/* Step 1: Profile */}
        {step === 1 && (
          <div className="fade-in flex flex-col gap-6">
            <div>
              <h2 className="text-2xl font-extrabold text-[var(--text)] mb-1">Tell us about yourself</h2>
              <p className="text-sm text-[var(--muted)]">This personalises your experience.</p>
            </div>
            <Input label="Your name" value={name} onChange={e => setName(e.target.value)} placeholder="Peter" className="focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--blue)] focus-visible:outline-offset-2" />
            <Select
              label="Age range"
              value={ageRange}
              onChange={e => setAgeRange(e.target.value as AgeRange)}
              options={[
                { value: '18-30', label: '18 – 30' },
                { value: '31-50', label: '31 – 50' },
                { value: '51-70', label: '51 – 70' },
                { value: '70+',   label: '70+' },
              ]}
              className="focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--blue)] focus-visible:outline-offset-2"
            />
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-mono uppercase tracking-wider text-[var(--muted)]">Timezone</label>
              <p className="text-sm text-[var(--text)] bg-[var(--surface2)] px-4 py-3 rounded-xl border border-[var(--border)] font-mono tabular-nums">
                {timezone}
              </p>
              <p className="text-xs text-[var(--muted)]">Auto-detected. Change in settings later.</p>
            </div>
            <Button fullWidth size="lg" onClick={handleStep1} disabled={!name.trim()} className="focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--blue)] focus-visible:outline-offset-2">
              Continue →
            </Button>
          </div>
        )}

        {/* Step 2: First protocol */}
        {step === 2 && (
          <div className="fade-in flex flex-col gap-5">
            <div>
              <h2 className="text-2xl font-extrabold text-[var(--text)] mb-1">Choose a starter protocol</h2>
              <p className="text-sm text-[var(--muted)]">Pick one to get started, or skip and build your own.</p>
            </div>

            <div className="flex flex-col gap-3 max-h-[380px] overflow-y-auto pr-1">
              {templates.map(p => (
                <button
                  key={p.id}
                  onClick={() => setSelectedProtocolId(prev => prev === p.id ? null : p.id)}
                  className={[
                    'text-left p-4 rounded-2xl border transition-all duration-200',
                    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--blue)] focus-visible:outline-offset-2',
                    selectedProtocolId === p.id
                      ? 'border-[var(--blue)] bg-[rgba(var(--blue-rgb),0.1)]'
                      : 'border-[var(--border)] bg-[var(--surface)] hover:border-[var(--border-strong)]',
                  ].join(' ')}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-bold text-[var(--text)]">{p.name}</div>
                      <div className="text-xs text-[var(--muted)] mt-1 leading-relaxed">{p.description}</div>
                    </div>
                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                      <span className="text-[10px] font-mono font-semibold uppercase tracking-wider text-[var(--blue-text)] bg-[rgba(var(--blue-rgb),0.15)] px-2 py-1 rounded-full">
                        {CATEGORY_LABELS[p.category]}
                      </span>
                      <span className="text-[10px] font-mono tabular-nums text-[var(--muted)]">{p.items.length} items</span>
                    </div>
                  </div>
                </button>
              ))}
            </div>

            <div className="flex gap-3">
              <Button variant="secondary" fullWidth onClick={() => handleStep2(true)} className="focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--blue)] focus-visible:outline-offset-2">
                Skip for now
              </Button>
              <Button fullWidth onClick={() => handleStep2(false)} className="focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--blue)] focus-visible:outline-offset-2">
                {selectedProtocolId ? 'Use this protocol →' : 'Continue →'}
              </Button>
            </div>
          </div>
        )}

        {/* Step 3: Reminder times */}
        {step === 3 && (
          <div className="fade-in flex flex-col gap-6">
            <div>
              <h2 className="text-2xl font-extrabold text-[var(--text)] mb-1">Set your reminder times</h2>
              <p className="text-sm text-[var(--muted)]">These are defaults. You can adjust per-protocol later.</p>
            </div>

            <div className="flex flex-col gap-4">
              {[
                { label: 'Morning', value: morningTime, onChange: setMorningTime },
                { label: 'Afternoon', value: afternoonTime, onChange: setAfternoonTime },
                { label: 'Evening', value: eveningTime, onChange: setEveningTime },
              ].map(({ label, value, onChange }) => (
                <div key={label} className="flex items-center justify-between bg-[var(--surface)] border border-[var(--border)] rounded-2xl px-4 py-4">
                  <span className="text-sm font-semibold text-[var(--text)]">{label}</span>
                  <input
                    type="time"
                    value={value}
                    onChange={e => onChange(e.target.value)}
                    className="bg-[var(--surface2)] border border-[var(--border)] rounded-xl px-3 py-2 text-[var(--text)] text-sm font-mono tabular-nums outline-none focus:border-[var(--blue)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--blue)] focus-visible:outline-offset-2"
                  />
                </div>
              ))}
            </div>

            {installState === 'browser' ? (
              <div className="bg-[rgba(var(--yellow-rgb),0.08)] border border-[rgba(var(--yellow-rgb),0.25)] rounded-xl px-4 py-3 flex flex-col gap-1">
                <p className="text-xs font-semibold text-[var(--yellow)]">Add to Home Screen for push reminders</p>
                <p className="text-xs text-[var(--muted)] leading-relaxed">
                  Tap the share icon in Safari, then &ldquo;Add to Home Screen&rdquo;. Push notifications only work from the installed app.
                </p>
              </div>
            ) : (
              <p className="text-xs text-[var(--muted)] leading-relaxed bg-[rgba(var(--green-rgb),0.06)] border border-[rgba(var(--green-rgb),0.2)] rounded-xl px-4 py-3">
                Push reminders will be requested when you tap Get started.
              </p>
            )}

            <Button fullWidth size="lg" onClick={handleFinish} className="focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--blue)] focus-visible:outline-offset-2">
              Get started →
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
