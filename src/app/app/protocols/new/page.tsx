'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import { useStore } from '@/lib/store/store';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import type { ProtocolCategory, ItemType, DoseForm, RouteOfAdmin, FrequencyType, ProtocolItem } from '@/types';
import { DOSE_FORM_ICONS, ROUTE_ICONS } from '@/lib/icons';

const CATEGORIES: { value: ProtocolCategory; label: string }[] = [
  { value: 'general',       label: '🌿 General Health' },
  { value: 'cardiovascular', label: '❤️ Cardiovascular' },
  { value: 'metabolic',     label: '⚙️ Metabolic' },
  { value: 'hormonal',      label: '🔬 Hormonal' },
  { value: 'neurological',  label: '🧠 Neurological' },
  { value: 'immune',        label: '🛡️ Immune' },
  { value: 'custom',        label: '✏️ Custom' },
];

type ItemDraft = Omit<ProtocolItem, 'id' | 'protocolId'>;

function frequencyLabel(item: { frequencyType: FrequencyType; frequencyValue?: number }) {
  if (item.frequencyType === 'every_n_days') {
    return `every ${item.frequencyValue ?? 1} days`;
  }
  return item.frequencyType.replace(/_/g, ' ');
}

function emptyItem(): ItemDraft {
  return {
    itemType: 'medication', name: '', doseUnit: 'mg', doseForm: 'tablet', route: 'oral',
    frequencyType: 'daily', frequencyValue: undefined, times: ['08:00'], withFood: 'any',
    startDay: 1, sortOrder: 0, icon: '💊', color: 'blue',
  };
}

function generateDraftItemId() {
  const c = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (c?.randomUUID) return c.randomUUID();
  const rand = Math.random().toString(16).slice(2, 10);
  return `protocol-item-${Date.now()}-${rand}`;
}

function parseFixedDurationDays(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return null;
  if (!Number.isInteger(parsed)) return null;
  if (parsed <= 0) return null;
  return parsed;
}

export default function NewProtocolPage() {
  const router = useRouter();
  const { profile, createCustomProtocol, activateProtocol } = useStore();
  const { show } = useToast();
  const [step, setStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Step 1
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<ProtocolCategory>('custom');
  const [duration, setDuration] = useState<'ongoing' | 'fixed'>('ongoing');
  const [durationDays, setDurationDays] = useState('30');

  // Step 2
  const [items, setItems] = useState<ItemDraft[]>([]);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [draft, setDraft] = useState<ItemDraft>(emptyItem());

  // Step 3
  const [activateNow, setActivateNow] = useState(true);

  function handleStep1() {
    if (!name.trim()) { show('Protocol name is required', 'warning'); return; }
    if (duration === 'fixed' && parseFixedDurationDays(durationDays) === null) {
      show('Fixed duration must be a positive whole number of days', 'warning');
      return;
    }
    setStep(2);
  }

  function addItem() {
    if (!draft.name.trim()) { show('Item name required', 'warning'); return; }
    if (editingIdx !== null) {
      setItems(prev => prev.map((it, i) => i === editingIdx ? draft : it));
      setEditingIdx(null);
    } else {
      setItems(prev => [...prev, { ...draft, sortOrder: prev.length }]);
    }
    setDraft(emptyItem());
  }

  function removeItem(idx: number) {
    setItems(prev => prev.filter((_, i) => i !== idx));
  }

  function handleFinish() {
    if (isSubmitting) return;
    const parsedFixedDurationDays = duration === 'fixed' ? parseFixedDurationDays(durationDays) : null;
    if (duration === 'fixed' && parsedFixedDurationDays === null) {
      show('Fixed duration must be a positive whole number of days', 'warning');
      return;
    }
    const validatedDurationDays = duration === 'fixed' ? parsedFixedDurationDays ?? undefined : undefined;
    if (!items.length) {
      show('Add at least one item before finalizing', 'warning');
      return;
    }
    for (const item of items) {
      if (item.frequencyType === 'every_n_days' && (!item.frequencyValue || item.frequencyValue < 1)) {
        show(`Set "Every N days" value for ${item.name || 'an item'}`, 'warning');
        return;
      }
    }
    setIsSubmitting(true);
    let createdProtocolId: string | null = null;
    try {
      const protocol = createCustomProtocol({
        name: name.trim(),
        description: description.trim() || undefined,
        category,
        durationDays: validatedDurationDays,
        items: items.map((it, i) => ({ ...it, id: generateDraftItemId(), protocolId: '_temp_', sortOrder: i })),
        isArchived: false,
      });
      createdProtocolId = protocol.id;

      if (activateNow) {
        try {
          if (!profile?.id) {
            throw new Error('Profile not ready for activation');
          }
          activateProtocol(protocol.id, format(new Date(), 'yyyy-MM-dd'));
          show('✓ Protocol created and activated');
        } catch (activationError) {
          console.error('[protocol-activation-failed]', activationError);
          show('Protocol created, but activation failed. Activate it from Protocols.', 'warning');
        }
      } else {
        show('✓ Protocol saved');
      }
      router.push('/app/protocols');
    } catch (error) {
      console.error('[protocol-finalize-failed]', error);
      if (createdProtocolId) console.error('[protocol-created-before-fail]', createdProtocolId);
      show('Could not finalize protocol. Please try again.', 'warning');
    } finally {
      setIsSubmitting(false);
    }
  }

  const COLORS = ['blue','green','purple','yellow','red','pink'];
  const COLOR_VALS: Record<string, string> = {
    blue:'#3B82F6', green:'#10B981', purple:'#8B5CF6',
    yellow:'#FBBF24', red:'#EF4444', pink:'#EC4899',
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-5 pt-4 pb-3 flex-shrink-0 border-b border-[rgba(255,255,255,0.05)]">
        <div className="flex items-center gap-3">
          <button onClick={() => step > 1 ? setStep(s => s - 1) : router.back()} className="text-[#8B949E] text-xl">←</button>
          <h1 className="text-lg font-extrabold text-[#F0F6FC]">New Protocol</h1>
        </div>
        {/* Steps */}
        <div className="flex gap-1 mt-3">
          {['Protocol Info', 'Add Items', 'Confirm'].map((label, i) => (
            <div key={label} className="flex items-center gap-1 flex-1">
              <div className={`h-1 flex-1 rounded-full transition-colors ${i + 1 <= step ? 'bg-[#3B82F6]' : 'bg-[#1C2333]'}`} />
            </div>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-5">

        {/* Step 1: Protocol Info */}
        {step === 1 && (
          <div className="fade-in flex flex-col gap-5">
            <Input label="Protocol name" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. My Morning Stack" />
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-[#8B949E] uppercase tracking-wide">Description (optional)</label>
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="What is this protocol for?"
                rows={3}
                className="w-full bg-[#1C2333] border border-[rgba(255,255,255,0.08)] rounded-xl px-4 py-3 text-[#F0F6FC] text-sm outline-none focus:border-[#3B82F6] resize-none"
              />
            </div>
            <Select label="Category" value={category} onChange={e => setCategory(e.target.value as ProtocolCategory)} options={CATEGORIES} />
            <div>
              <label className="text-xs font-semibold text-[#8B949E] uppercase tracking-wide mb-2 block">Duration</label>
              <div className="flex gap-2">
                {(['ongoing', 'fixed'] as const).map(d => (
                  <button key={d} onClick={() => setDuration(d)}
                    className={`flex-1 py-3 rounded-xl text-sm font-semibold border transition-colors ${duration === d ? 'bg-[#3B82F6] border-[#3B82F6] text-white' : 'border-[rgba(255,255,255,0.08)] text-[#8B949E]'}`}>
                    {d === 'ongoing' ? '∞ Ongoing' : '📅 Fixed'}
                  </button>
                ))}
              </div>
              {duration === 'fixed' && (
                <div className="mt-3">
                  <Input label="Number of days" type="number" value={durationDays} onChange={e => setDurationDays(e.target.value)} />
                </div>
              )}
            </div>
            <Button fullWidth size="lg" onClick={handleStep1} className="mt-2">Next →</Button>
          </div>
        )}

        {/* Step 2: Add Items */}
        {step === 2 && (
          <div className="fade-in flex flex-col gap-4">
            <p className="text-sm text-[#8B949E]">Add medications, analyses, and therapies to this protocol.</p>

            {/* Existing items */}
            {items.map((it, idx) => (
              <div key={idx} className="flex items-center gap-3 bg-[#161B22] border border-[rgba(255,255,255,0.08)] rounded-xl p-3">
                <span className="text-xl">{it.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-[#F0F6FC] truncate">{it.name} {it.doseAmount ? `${it.doseAmount}${it.doseUnit}` : ''}</div>
                  <div className="text-xs text-[#8B949E]">{frequencyLabel(it)} · {it.times.join(', ')}</div>
                </div>
                <button onClick={() => { setDraft({ ...it }); setEditingIdx(idx); }} className="text-[#8B949E] hover:text-[#3B82F6] text-sm px-2">✏️</button>
                <button onClick={() => removeItem(idx)} className="text-[#8B949E] hover:text-[#EF4444] text-sm px-2">✕</button>
              </div>
            ))}

            {/* Item form */}
            <div className="bg-[#161B22] border border-[rgba(59,130,246,0.25)] rounded-2xl p-4 flex flex-col gap-3">
              <div className="text-xs font-bold text-[#3B82F6] uppercase tracking-wide mb-1">
                {editingIdx !== null ? 'Edit item' : 'Add item'}
              </div>

              <Select label="Type" value={draft.itemType}
                onChange={e => setDraft(d => ({ ...d, itemType: e.target.value as ItemType, icon: e.target.value === 'analysis' ? '🧪' : e.target.value === 'therapy' ? '🩺' : '💊' }))}
                options={[
                  { value: 'medication', label: '💊 Medication' },
                  { value: 'analysis',   label: '🧪 Lab Analysis' },
                  { value: 'therapy',    label: '🩺 Therapy' },
                ]}
              />

              <Input label="Name" value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} placeholder="e.g. Vitamin D3" />

              {draft.itemType === 'medication' && (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <Input label="Amount" type="number" value={draft.doseAmount?.toString() ?? ''} onChange={e => setDraft(d => ({ ...d, doseAmount: e.target.value ? parseFloat(e.target.value) : undefined }))} placeholder="500" />
                    <Select label="Unit" value={draft.doseUnit ?? 'mg'} onChange={e => setDraft(d => ({ ...d, doseUnit: e.target.value }))}
                      options={['mg','mcg','IU','ml','units','g'].map(v => ({ value: v, label: v }))} />
                  </div>
                  <Select label="Form" value={draft.doseForm ?? 'tablet'} onChange={e => setDraft(d => ({ ...d, doseForm: e.target.value as DoseForm }))}
                    options={[
                      {value:'tablet',      label:`${DOSE_FORM_ICONS.tablet} Tablet`},
                      {value:'capsule',     label:`${DOSE_FORM_ICONS.capsule} Capsule`},
                      {value:'softgel',     label:`${DOSE_FORM_ICONS.softgel} Soft-gel`},
                      {value:'injection',   label:`${DOSE_FORM_ICONS.injection} Injection`},
                      {value:'cream',       label:`${DOSE_FORM_ICONS.cream} Cream / Gel`},
                      {value:'drops',       label:`${DOSE_FORM_ICONS.drops} Drops`},
                      {value:'powder',      label:`${DOSE_FORM_ICONS.powder} Powder`},
                      {value:'liquid',      label:`${DOSE_FORM_ICONS.liquid} Liquid / Syrup`},
                      {value:'patch',       label:`${DOSE_FORM_ICONS.patch} Patch`},
                      {value:'inhaler',     label:`${DOSE_FORM_ICONS.inhaler} Inhaler`},
                      {value:'spray',       label:`${DOSE_FORM_ICONS.spray} Spray`},
                      {value:'eye_drops',   label:`${DOSE_FORM_ICONS.eye_drops} Eye drops`},
                      {value:'nasal_spray', label:`${DOSE_FORM_ICONS.nasal_spray} Nasal spray`},
                      {value:'suppository', label:`${DOSE_FORM_ICONS.suppository} Suppository`},
                      {value:'lozenge',     label:`${DOSE_FORM_ICONS.lozenge} Lozenge`},
                      {value:'other',       label:`${DOSE_FORM_ICONS.other} Other`},
                    ]}
                  />
                  <Select label="Route" value={draft.route ?? 'oral'} onChange={e => setDraft(d => ({ ...d, route: e.target.value as RouteOfAdmin }))}
                    options={[
                      {value:'oral',          label:`${ROUTE_ICONS.oral} Oral`},
                      {value:'subcutaneous',  label:`${ROUTE_ICONS.subcutaneous} Subcutaneous`},
                      {value:'intramuscular', label:`${ROUTE_ICONS.intramuscular} Intramuscular`},
                      {value:'topical',       label:`${ROUTE_ICONS.topical} Topical`},
                      {value:'sublingual',    label:`${ROUTE_ICONS.sublingual} Sublingual`},
                      {value:'inhalation',    label:`${ROUTE_ICONS.inhalation} Inhalation`},
                      {value:'nasal',         label:`${ROUTE_ICONS.nasal} Nasal`},
                      {value:'iv',            label:`${ROUTE_ICONS.iv} IV`},
                      {value:'other',         label:`${ROUTE_ICONS.other} Other`},
                    ]}
                  />
                  <Select label="With food" value={draft.withFood ?? 'any'} onChange={e => setDraft(d => ({ ...d, withFood: e.target.value as 'yes'|'no'|'any' }))}
                    options={[{value:'any',label:'No preference'},{value:'yes',label:'With food'},{value:'no',label:'Empty stomach'}]}
                  />
                </>
              )}

              <Select label="Frequency" value={draft.frequencyType} onChange={e => {
                const nextFrequency = e.target.value as FrequencyType;
                setDraft(d => ({
                  ...d,
                  frequencyType: nextFrequency,
                  frequencyValue:
                    nextFrequency === 'every_n_days'
                      ? Math.max(1, d.frequencyValue ?? 2)
                      : undefined,
                }));
              }}
                options={[
                  {value:'daily',label:'Once daily'},{value:'twice_daily',label:'Twice daily'},
                  {value:'three_times_daily',label:'Three times daily'},{value:'every_n_days',label:'Every N days'},
                  {value:'weekly',label:'Weekly'},
                ]}
              />

              {draft.frequencyType === 'every_n_days' && (
                <Input
                  label="Every N days"
                  type="number"
                  value={String(draft.frequencyValue ?? 2)}
                  onChange={e =>
                    setDraft(d => ({
                      ...d,
                      frequencyValue: Math.max(1, parseInt(e.target.value || '1', 10)),
                    }))
                  }
                  placeholder="e.g. 3"
                />
              )}

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-[#8B949E] uppercase tracking-wide">Time</label>
                <input type="time" value={draft.times[0] ?? '08:00'} onChange={e => setDraft(d => ({ ...d, times: [e.target.value] }))}
                  className="bg-[#1C2333] border border-[rgba(255,255,255,0.08)] rounded-xl px-4 py-3 text-[#F0F6FC] text-sm outline-none focus:border-[#3B82F6]"
                />
              </div>

              {/* Color picker */}
              <div>
                <label className="text-xs font-semibold text-[#8B949E] uppercase tracking-wide mb-2 block">Colour</label>
                <div className="flex gap-2">
                  {COLORS.map(c => (
                    <button key={c} onClick={() => setDraft(d => ({ ...d, color: c }))}
                      className={`w-7 h-7 rounded-full transition-all ${draft.color === c ? 'scale-125 ring-2 ring-white/40' : ''}`}
                      style={{ background: COLOR_VALS[c] }}
                    />
                  ))}
                </div>
              </div>

              <Button onClick={addItem} variant={editingIdx !== null ? 'secondary' : 'primary'}>
                {editingIdx !== null ? 'Update item' : '+ Add item'}
              </Button>
            </div>

            <div className="flex gap-3 mt-2">
              <Button variant="secondary" fullWidth onClick={() => setStep(1)}>← Back</Button>
              <Button fullWidth onClick={() => setStep(3)}>Review →</Button>
            </div>
          </div>
        )}

        {/* Step 3: Review */}
        {step === 3 && (
          <div className="fade-in flex flex-col gap-5">
            <div className="bg-[#161B22] border border-[rgba(255,255,255,0.08)] rounded-2xl p-4">
              <div className="text-base font-extrabold text-[#F0F6FC] mb-1">{name}</div>
              {description && <div className="text-sm text-[#8B949E] mb-3">{description}</div>}
              <div className="flex gap-2 text-xs text-[#8B949E]">
                <span className="bg-[rgba(59,130,246,0.12)] text-[#3B82F6] px-2 py-1 rounded-full font-semibold">{category}</span>
                <span className="bg-[rgba(255,255,255,0.05)] px-2 py-1 rounded-full">{duration === 'ongoing' ? '∞ Ongoing' : `${durationDays} days`}</span>
                <span className="bg-[rgba(255,255,255,0.05)] px-2 py-1 rounded-full">{items.length} items</span>
              </div>
            </div>

            {items.length === 0 && (
              <p className="text-xs text-[#FBBF24] bg-[rgba(251,191,36,0.1)] border border-[rgba(251,191,36,0.2)] rounded-xl px-4 py-3">
                ⚠️ No items added. You can add them later from the protocol detail page.
              </p>
            )}

            <div className="flex items-center gap-3 bg-[#161B22] border border-[rgba(255,255,255,0.08)] rounded-xl p-4">
              <input type="checkbox" checked={activateNow} onChange={e => setActivateNow(e.target.checked)} className="w-4 h-4 accent-[#3B82F6]" />
              <div>
                <div className="text-sm font-semibold text-[#F0F6FC]">Activate now</div>
                <div className="text-xs text-[#8B949E]">Start generating doses from today</div>
              </div>
            </div>

            <div className="flex gap-3">
              <Button variant="secondary" fullWidth onClick={() => setStep(2)} disabled={isSubmitting}>← Back</Button>
              <Button fullWidth size="lg" onClick={handleFinish} loading={isSubmitting} disabled={isSubmitting}>
                {isSubmitting ? 'Saving…' : (activateNow ? 'Create & Activate' : 'Save Protocol')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
