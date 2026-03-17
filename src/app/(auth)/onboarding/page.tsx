'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useStore } from '@/lib/store/store';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import type { AgeRange, ProtocolCategory } from '@/types';

const CATEGORY_LABELS: Record<ProtocolCategory, string> = {
  general: '🌿 General Health',
  cardiovascular: '❤️ Cardiovascular',
  metabolic: '⚙️ Metabolic',
  hormonal: '🔬 Hormonal',
  neurological: '🧠 Neurological',
  immune: '🛡️ Immune',
  custom: '✏️ Custom',
};

export default function OnboardingPage() {
  const router = useRouter();
  const { profile, completeOnboarding, protocols, activateProtocol } = useStore();
  const [step, setStep] = useState(1);

  // Step 1 state
  const [name, setName] = useState(profile?.name ?? '');
  const [timezone, setTimezone] = useState(
    typeof window !== 'undefined'
      ? Intl.DateTimeFormat().resolvedOptions().timeZone
      : 'UTC'
  );
  const [ageRange, setAgeRange] = useState<AgeRange>('31-50');

  // Step 2 state
  const [selectedProtocolId, setSelectedProtocolId] = useState<string | null>(null);

  // Step 3 state
  const [morningTime, setMorningTime] = useState('08:00');
  const [afternoonTime, setAfternoonTime] = useState('13:00');
  const [eveningTime, setEveningTime] = useState('21:00');

  const templates = protocols.filter(p => p.isTemplate);

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

  function handleFinish() {
    completeOnboarding({ name: name.trim(), timezone, ageRange });
    if (selectedProtocolId) {
      const today = new Date().toISOString().slice(0, 10);
      activateProtocol(selectedProtocolId, today);
    }
    router.push('/app');
  }

  const stepLabels = ['Profile', 'First Protocol', 'Reminders'];

  return (
    <div className="min-h-screen bg-[#0D1117] flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="flex items-center gap-3 justify-center mb-8">
          <div className="w-10 h-10 rounded-xl bg-[#3B82F6] flex items-center justify-center text-xl">💊</div>
          <span className="text-xl font-bold text-[#F0F6FC]">MedRemind</span>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-2 mb-8">
          {stepLabels.map((label, i) => (
            <div key={label} className="flex items-center gap-2 flex-1">
              <div className={[
                'w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0',
                i + 1 < step ? 'bg-[#10B981] text-white' : i + 1 === step ? 'bg-[#3B82F6] text-white' : 'bg-[#1C2333] text-[#8B949E]',
              ].join(' ')}>
                {i + 1 < step ? '✓' : i + 1}
              </div>
              <span className={`text-xs font-semibold ${i + 1 === step ? 'text-[#F0F6FC]' : 'text-[#8B949E]'}`}>{label}</span>
              {i < 2 && <div className="flex-1 h-px bg-[rgba(255,255,255,0.08)]" />}
            </div>
          ))}
        </div>

        {/* Step 1: Profile */}
        {step === 1 && (
          <div className="fade-in flex flex-col gap-6">
            <div>
              <h2 className="text-2xl font-extrabold text-[#F0F6FC] mb-1">Tell us about yourself</h2>
              <p className="text-sm text-[#8B949E]">This personalises your experience.</p>
            </div>
            <Input label="Your name" value={name} onChange={e => setName(e.target.value)} placeholder="Peter" />
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
            />
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-[#8B949E] uppercase tracking-wide">Timezone</label>
              <p className="text-sm text-[#F0F6FC] bg-[#1C2333] px-4 py-3 rounded-xl border border-[rgba(255,255,255,0.08)]">
                {timezone}
              </p>
              <p className="text-xs text-[#8B949E]">Auto-detected. Change in settings later.</p>
            </div>
            <Button fullWidth size="lg" onClick={handleStep1} disabled={!name.trim()}>
              Continue →
            </Button>
          </div>
        )}

        {/* Step 2: First protocol */}
        {step === 2 && (
          <div className="fade-in flex flex-col gap-5">
            <div>
              <h2 className="text-2xl font-extrabold text-[#F0F6FC] mb-1">Choose a starter protocol</h2>
              <p className="text-sm text-[#8B949E]">Pick one to get started, or skip and build your own.</p>
            </div>

            <div className="flex flex-col gap-3 max-h-[380px] overflow-y-auto pr-1">
              {templates.map(p => (
                <button
                  key={p.id}
                  onClick={() => setSelectedProtocolId(prev => prev === p.id ? null : p.id)}
                  className={[
                    'text-left p-4 rounded-2xl border transition-all duration-200',
                    selectedProtocolId === p.id
                      ? 'border-[#3B82F6] bg-[rgba(59,130,246,0.1)]'
                      : 'border-[rgba(255,255,255,0.08)] bg-[#161B22] hover:border-[rgba(255,255,255,0.2)]',
                  ].join(' ')}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-bold text-[#F0F6FC]">{p.name}</div>
                      <div className="text-xs text-[#8B949E] mt-1 leading-relaxed">{p.description}</div>
                    </div>
                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-[#3B82F6] bg-[rgba(59,130,246,0.15)] px-2 py-1 rounded-full">
                        {CATEGORY_LABELS[p.category]}
                      </span>
                      <span className="text-[10px] text-[#8B949E]">{p.items.length} items</span>
                    </div>
                  </div>
                </button>
              ))}
            </div>

            <div className="flex gap-3">
              <Button variant="secondary" fullWidth onClick={() => handleStep2(true)}>
                Skip for now
              </Button>
              <Button fullWidth onClick={() => handleStep2(false)}>
                {selectedProtocolId ? 'Use this protocol →' : 'Continue →'}
              </Button>
            </div>
          </div>
        )}

        {/* Step 3: Reminder times */}
        {step === 3 && (
          <div className="fade-in flex flex-col gap-6">
            <div>
              <h2 className="text-2xl font-extrabold text-[#F0F6FC] mb-1">Set your reminder times</h2>
              <p className="text-sm text-[#8B949E]">These are defaults. You can adjust per-protocol later.</p>
            </div>

            <div className="flex flex-col gap-4">
              {[
                { label: '🌅 Morning', value: morningTime, onChange: setMorningTime },
                { label: '☀️ Afternoon', value: afternoonTime, onChange: setAfternoonTime },
                { label: '🌙 Evening', value: eveningTime, onChange: setEveningTime },
              ].map(({ label, value, onChange }) => (
                <div key={label} className="flex items-center justify-between bg-[#161B22] border border-[rgba(255,255,255,0.08)] rounded-2xl px-4 py-4">
                  <span className="text-sm font-semibold text-[#F0F6FC]">{label}</span>
                  <input
                    type="time"
                    value={value}
                    onChange={e => onChange(e.target.value)}
                    className="bg-[#1C2333] border border-[rgba(255,255,255,0.08)] rounded-xl px-3 py-2 text-[#F0F6FC] text-sm outline-none focus:border-[#3B82F6]"
                  />
                </div>
              ))}
            </div>

            <p className="text-xs text-[#8B949E] leading-relaxed bg-[rgba(59,130,246,0.08)] border border-[rgba(59,130,246,0.2)] rounded-xl px-4 py-3">
              💡 Browser notifications will be requested when you first open the app. You can manage this in Settings.
            </p>

            <Button fullWidth size="lg" onClick={handleFinish}>
              Get started →
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
