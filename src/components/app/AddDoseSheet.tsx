'use client';
import { useEffect, useRef, useState } from 'react';
import { useStore } from '@/lib/store/store';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import { v4 as uuid } from 'uuid';
import type { DoseForm, RouteOfAdmin, FrequencyType, ItemType } from '@/types';
import { format } from 'date-fns';

interface Props { open: boolean; onClose: () => void; }

const ITEM_TYPES: { value: ItemType; label: string }[] = [
  { value: 'medication', label: '💊 Medication / Supplement' },
  { value: 'analysis',   label: '🧪 Lab Analysis / Test' },
  { value: 'therapy',    label: '🩺 Therapy / Procedure' },
];

const DOSE_FORMS: { value: DoseForm; label: string }[] = [
  { value: 'tablet',   label: 'Tablet' },
  { value: 'capsule',  label: 'Capsule' },
  { value: 'injection', label: 'Injection' },
  { value: 'drops',    label: 'Drops / Liquid' },
  { value: 'cream',    label: 'Cream / Gel' },
  { value: 'powder',   label: 'Powder' },
  { value: 'patch',    label: 'Patch' },
  { value: 'inhaler',  label: 'Inhaler' },
  { value: 'other',    label: 'Other' },
];

const ROUTES: { value: RouteOfAdmin; label: string }[] = [
  { value: 'oral',            label: 'Oral (by mouth)' },
  { value: 'subcutaneous',    label: 'Subcutaneous injection' },
  { value: 'intramuscular',   label: 'Intramuscular injection' },
  { value: 'topical',         label: 'Topical (skin)' },
  { value: 'sublingual',      label: 'Sublingual (under tongue)' },
  { value: 'inhalation',      label: 'Inhalation' },
  { value: 'nasal',           label: 'Nasal' },
  { value: 'iv',              label: 'IV' },
  { value: 'other',           label: 'Other' },
];

const WITH_FOOD = [
  { value: 'any', label: 'No preference' },
  { value: 'yes', label: 'Take with food' },
  { value: 'no',  label: 'Take on empty stomach' },
];

export function AddDoseSheet({ open, onClose }: Props) {
  const { activeProtocols, protocols, activateProtocol, createCustomProtocol, addProtocolItem, regenerateDoses } = useStore();
  const { show } = useToast();

  const [itemType, setItemType] = useState<ItemType>('medication');
  const [name, setName] = useState('');
  const [doseAmount, setDoseAmount] = useState('');
  const [doseUnit, setDoseUnit] = useState('mg');
  const [doseForm, setDoseForm] = useState<DoseForm>('tablet');
  const [route, setRoute] = useState<RouteOfAdmin>('oral');
  const [time, setTime] = useState('08:00');
  const [withFood, setWithFood] = useState<'yes'|'no'|'any'>('any');
  const [instructions, setInstructions] = useState('');
  const [frequency, setFrequency] = useState<FrequencyType>('daily');
  const [frequencyValue, setFrequencyValue] = useState('2');
  const [targetProtocolId, setTargetProtocolId] = useState<string>('');

  const activeCustomProtocols = activeProtocols.filter(ap => ap.status === 'active');

  useEffect(() => {
    if (activeCustomProtocols.length > 0 && !targetProtocolId) {
      setTargetProtocolId(activeCustomProtocols[0].protocolId);
    }
  }, [activeCustomProtocols]);

  function reset() {
    setName(''); setDoseAmount(''); setDoseUnit('mg');
    setDoseForm('tablet'); setRoute('oral'); setTime('08:00');
    setWithFood('any'); setInstructions(''); setFrequency('daily'); setFrequencyValue('2');
  }

  function handleAdd() {
    if (!name.trim()) { show('Enter a name', 'warning'); return; }

    let protocolId = targetProtocolId;

    // If no active protocols, create a "My Protocol" and activate it
    if (!protocolId || activeCustomProtocols.length === 0) {
      const myProtocol = protocols.find(p => p.name === 'My Protocol' && !p.isTemplate);
      if (myProtocol) {
        protocolId = myProtocol.id;
        // ensure it's active
        if (!activeProtocols.find(ap => ap.protocolId === protocolId && ap.status === 'active')) {
          activateProtocol(protocolId, format(new Date(), 'yyyy-MM-dd'));
        }
      } else {
        const newProto = createCustomProtocol({
          name: 'My Protocol',
          description: 'Your personal medication list',
          category: 'custom',
          items: [],
          isArchived: false,
        });
        protocolId = newProto.id;
        activateProtocol(protocolId, format(new Date(), 'yyyy-MM-dd'));
      }
    }

    const times = frequency === 'twice_daily' ? [time, addHours(time, 12)] :
                  frequency === 'three_times_daily' ? [time, addHours(time, 6), addHours(time, 12)] :
                  [time];

    addProtocolItem(protocolId, {
      itemType,
      name: name.trim(),
      doseAmount: doseAmount ? parseFloat(doseAmount) : undefined,
      doseUnit,
      doseForm,
      route,
      frequencyType: frequency,
      frequencyValue: frequency === 'every_n_days' ? Math.max(1, parseInt(frequencyValue || '1', 10)) : undefined,
      times,
      withFood,
      instructions: instructions.trim() || undefined,
      startDay: 1,
      sortOrder: 99,
      icon: itemType === 'analysis' ? '🧪' : itemType === 'therapy' ? '🩺' : '💊',
      color: ['blue', 'green', 'purple', 'yellow', 'red', 'pink'][Math.floor(Math.random() * 6)],
    });

    // Read activeProtocols from store directly (not stale closure) — activateProtocol
    // may have just run and the React closure hasn't updated yet.
    const freshInstance = useStore.getState().activeProtocols.find(
      ap => ap.protocolId === protocolId && ap.status === 'active'
    );
    if (freshInstance) regenerateDoses(freshInstance.id);

    show(`✓ ${name.trim()} added`);
    reset();
    onClose();
  }

  return (
    <>
      {/* Overlay */}
      <div
        className={`fixed inset-0 bg-black/70 z-50 transition-opacity duration-300 ${open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
        onClick={onClose}
      />

      {/* Sheet */}
      <div
        className={`fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[430px] bg-[#161B22] rounded-t-[24px] z-[51] transition-transform duration-300 ${open ? 'translate-y-0' : 'translate-y-full'}`}
      >
        <div className="w-9 h-1 bg-[rgba(255,255,255,0.12)] rounded-full mx-auto mt-3 mb-5" />
        <div className="px-5 pb-8 overflow-y-auto max-h-[85vh]">
          <h2 className="text-lg font-extrabold text-[#F0F6FC] mb-5">Add to Schedule</h2>

          <div className="flex flex-col gap-4">
            <Select label="Type" value={itemType} onChange={e => setItemType(e.target.value as ItemType)} options={ITEM_TYPES} />
            <Input label="Name" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Metformin" />

            {itemType === 'medication' && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Input label="Dose amount" type="number" value={doseAmount} onChange={e => setDoseAmount(e.target.value)} placeholder="500" />
                  <Select label="Unit" value={doseUnit} onChange={e => setDoseUnit(e.target.value)}
                    options={['mg','mcg','IU','ml','units','g'].map(v => ({ value: v, label: v }))} />
                </div>
                <Select label="Form" value={doseForm} onChange={e => setDoseForm(e.target.value as DoseForm)} options={DOSE_FORMS} />
                <Select label="Route of administration" value={route} onChange={e => setRoute(e.target.value as RouteOfAdmin)} options={ROUTES} />
                <Select label="With food?" value={withFood} onChange={e => setWithFood(e.target.value as 'yes'|'no'|'any')} options={WITH_FOOD} />
              </>
            )}

            <Select label="Frequency" value={frequency} onChange={e => setFrequency(e.target.value as FrequencyType)}
              options={[
                { value: 'daily',             label: 'Once daily' },
                { value: 'twice_daily',       label: 'Twice daily' },
                { value: 'three_times_daily', label: 'Three times daily' },
                { value: 'every_n_days',      label: 'Every N days' },
                { value: 'weekly',            label: 'Weekly' },
              ]}
            />

            {frequency === 'every_n_days' && (
              <Input
                label="Every N days"
                type="number"
                value={frequencyValue}
                onChange={e => setFrequencyValue(String(Math.max(1, parseInt(e.target.value || '1', 10))))}
                placeholder="e.g. 3"
              />
            )}

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-[#8B949E] uppercase tracking-wide">First dose time</label>
              <input
                type="time" value={time} onChange={e => setTime(e.target.value)}
                className="w-full bg-[#1C2333] border border-[rgba(255,255,255,0.08)] rounded-xl px-4 py-3 text-[#F0F6FC] text-sm outline-none focus:border-[#3B82F6]"
              />
            </div>

            {itemType === 'medication' && (
              <Input label="Special instructions (optional)" value={instructions} onChange={e => setInstructions(e.target.value)} placeholder="e.g. Take 30 min before meal" />
            )}

            <Button fullWidth size="lg" onClick={handleAdd} className="mt-2">
              Add to Schedule
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}

function addHours(time: string, hours: number): string {
  const [h, m] = time.split(':').map(Number);
  const total = (h + hours) % 24;
  return `${String(total).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
