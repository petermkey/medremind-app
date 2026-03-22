'use client';
import { use, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { format } from 'date-fns';
import { useStore } from '@/lib/store/store';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import type { DoseForm, FrequencyType, ProtocolCategory, ProtocolItem, RouteOfAdmin } from '@/types';
import { DOSE_FORM_ICONS, ROUTE_ICONS } from '@/lib/icons';

const ROUTE_LABELS: Record<string, string> = {
  oral: 'Oral', subcutaneous: 'Subcut.', intramuscular: 'IM',
  topical: 'Topical', sublingual: 'Sublingual', inhalation: 'Inhaler', nasal: 'Nasal', iv: 'IV', other: 'Other',
};

const CATEGORY_OPTIONS: { value: ProtocolCategory; label: string }[] = [
  { value: 'general', label: 'General Health' },
  { value: 'cardiovascular', label: 'Cardiovascular' },
  { value: 'metabolic', label: 'Metabolic' },
  { value: 'hormonal', label: 'Hormonal' },
  { value: 'neurological', label: 'Neurological' },
  { value: 'immune', label: 'Immune' },
  { value: 'custom', label: 'Custom' },
];

const COLORS = ['blue', 'green', 'purple', 'yellow', 'red', 'pink'];
const COLOR_VALS: Record<string, string> = {
  blue: '#3B82F6', green: '#10B981', purple: '#8B5CF6',
  yellow: '#FBBF24', red: '#EF4444', pink: '#EC4899',
};

type ItemDraft = {
  itemType: ProtocolItem['itemType'];
  name: string;
  doseAmount: string;
  doseUnit: string;
  doseForm: DoseForm;
  route: RouteOfAdmin;
  frequencyType: FrequencyType;
  frequencyValue: string;
  time: string;
  withFood: 'yes' | 'no' | 'any';
  instructions: string;
  icon: string;
  color: string;
};

function emptyDraft(): ItemDraft {
  return {
    itemType: 'medication',
    name: '',
    doseAmount: '',
    doseUnit: 'mg',
    doseForm: 'tablet',
    route: 'oral',
    frequencyType: 'daily',
    frequencyValue: '2',
    time: '08:00',
    withFood: 'any',
    instructions: '',
    icon: '💊',
    color: 'blue',
  };
}

function draftFromItem(item: ProtocolItem): ItemDraft {
  return {
    itemType: item.itemType,
    name: item.name,
    doseAmount: item.doseAmount !== undefined ? String(item.doseAmount) : '',
    doseUnit: item.doseUnit ?? 'mg',
    doseForm: item.doseForm ?? 'tablet',
    route: item.route ?? 'oral',
    frequencyType: item.frequencyType,
    frequencyValue: String(item.frequencyValue ?? 2),
    time: item.times[0] ?? '08:00',
    withFood: item.withFood ?? 'any',
    instructions: item.instructions ?? '',
    icon: item.icon ?? (item.itemType === 'analysis' ? '🧪' : item.itemType === 'therapy' ? '🩺' : '💊'),
    color: item.color ?? 'blue',
  };
}

function frequencyLabel(item: ProtocolItem) {
  if (item.frequencyType === 'every_n_days') {
    return `every ${item.frequencyValue ?? 1} days`;
  }
  return item.frequencyType.replace(/_/g, ' ');
}

export default function ProtocolDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const {
    protocols,
    selectProtocolDetailReadModel,
    activateProtocol,
    pauseProtocol,
    resumeProtocol,
    completeProtocol,
    updateProtocol,
    addProtocolItem,
    removeProtocolItem,
    regenerateDoses,
  } = useStore();
  const { show } = useToast();
  const todayStr = format(new Date(), 'yyyy-MM-dd');

  const protocol = protocols.find(p => p.id === id);
  const detailReadModel = selectProtocolDetailReadModel(id, todayStr);
  const instance = detailReadModel.instance;
  const protocolId = protocol?.id;

  const [metaName, setMetaName] = useState('');
  const [metaDescription, setMetaDescription] = useState('');
  const [metaCategory, setMetaCategory] = useState<ProtocolCategory>('custom');

  const [editingItem, setEditingItem] = useState<ProtocolItem | null>(null);
  const [itemDraft, setItemDraft] = useState<ItemDraft>(emptyDraft());

  useEffect(() => {
    if (!protocol) return;
    setMetaName(protocol.name);
    setMetaDescription(protocol.description ?? '');
    setMetaCategory(protocol.category);
  }, [protocol?.id, protocol?.name, protocol?.description, protocol?.category]);

  useEffect(() => {
    if (searchParams.get('edit') === '1') {
      const section = document.getElementById('protocol-edit-section');
      section?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [searchParams]);

  if (!protocol) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <div className="text-4xl">🤷</div>
        <div className="text-sm text-[#8B949E]">Protocol not found</div>
        <Button onClick={() => router.back()}>Go back</Button>
      </div>
    );
  }

  function saveProtocolMeta() {
    if (!protocol) return;
    if (!metaName.trim()) {
      show('Protocol name is required', 'warning');
      return;
    }
    updateProtocol(protocol.id, {
      name: metaName.trim(),
      description: metaDescription.trim() || undefined,
      category: metaCategory,
    });
    show('✓ Protocol details updated');
  }

  function openEditItem(item: ProtocolItem) {
    setEditingItem(item);
    setItemDraft(draftFromItem(item));
  }

  function resetItemEditor() {
    setEditingItem(null);
    setItemDraft(emptyDraft());
  }

  function buildItemPayload(sortOrder: number): Omit<ProtocolItem, 'id' | 'protocolId'> {
    const normalizedFrequencyValue = itemDraft.frequencyType === 'every_n_days'
      ? Math.max(1, parseInt(itemDraft.frequencyValue || '1', 10))
      : undefined;

    return {
      itemType: itemDraft.itemType,
      name: itemDraft.name.trim(),
      doseAmount: itemDraft.doseAmount ? parseFloat(itemDraft.doseAmount) : undefined,
      doseUnit: itemDraft.doseUnit || undefined,
      doseForm: itemDraft.itemType === 'medication' ? itemDraft.doseForm : undefined,
      route: itemDraft.itemType === 'medication' ? itemDraft.route : undefined,
      frequencyType: itemDraft.frequencyType,
      frequencyValue: normalizedFrequencyValue,
      times: [itemDraft.time],
      withFood: itemDraft.itemType === 'medication' ? itemDraft.withFood : undefined,
      instructions: itemDraft.instructions.trim() || undefined,
      startDay: 1,
      endDay: undefined,
      sortOrder,
      icon: itemDraft.icon,
      color: itemDraft.color,
      drugId: undefined,
    };
  }

  function saveItem() {
    if (!protocol) return;
    if (!itemDraft.name.trim()) {
      show('Item name is required', 'warning');
      return;
    }

    if (!editingItem) {
      addProtocolItem(protocol.id, buildItemPayload(protocol.items.length));
      if (instance && instance.status === 'active') regenerateDoses(instance.id);
      show('✓ Item added');
      resetItemEditor();
      return;
    }

    const updatedItems = protocol.items.map((item, idx) => {
      if (item.id !== editingItem.id) return item;
      return {
        ...item,
        ...buildItemPayload(idx),
      };
    });

    updateProtocol(protocol.id, { items: updatedItems });
    if (instance && instance.status === 'active') regenerateDoses(instance.id);
    show('✓ Item updated');
    resetItemEditor();
  }

  function handleDeleteItem(item: ProtocolItem) {
    if (!protocolId) return;
    if (!confirm(`Delete item "${item.name}"?`)) return;
    removeProtocolItem(protocolId, item.id);
    if (instance && instance.status === 'active') regenerateDoses(instance.id);
    show('Item deleted', 'warning');
  }

  function handleActivate() {
    activateProtocol(id, format(new Date(), 'yyyy-MM-dd'));
    show('✓ Protocol activated');
  }

  const statusColor = !instance ? '#8B949E' :
    instance.status === 'active' ? '#10B981' :
    instance.status === 'paused' ? '#FBBF24' : '#8B949E';

  return (
    <div className="flex flex-col h-full">
      <div className="px-5 pt-4 pb-3 flex-shrink-0 border-b border-[rgba(255,255,255,0.05)]">
        <button onClick={() => router.back()} className="text-[#8B949E] text-xl mb-3">← Back</button>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-extrabold text-[#F0F6FC]">{protocol.name}</h1>
            {protocol.description && <p className="text-xs text-[#8B949E] mt-1">{protocol.description}</p>}
            {detailReadModel.isArchived && <p className="text-[11px] text-[#FBBF24] mt-1 uppercase tracking-wide font-bold">Archived</p>}
          </div>
          {instance && (
            <span className="text-[11px] font-bold uppercase tracking-wide px-2 py-1 rounded-full flex-shrink-0" style={{ background: `${statusColor}20`, color: statusColor }}>
              {instance.status}
            </span>
          )}
        </div>

        <div className="flex gap-2 mt-4">
          {detailReadModel.canActivate && (
            <Button size="sm" onClick={handleActivate}>▶ Activate</Button>
          )}
          {detailReadModel.canPause && instance && (
            <Button size="sm" variant="secondary" onClick={() => { pauseProtocol(instance.id); show('Paused', 'warning'); }}>⏸ Pause</Button>
          )}
          {detailReadModel.canResume && instance && (
            <Button size="sm" onClick={() => { resumeProtocol(instance.id); show('Resumed'); }}>▶ Resume</Button>
          )}
          {detailReadModel.canComplete && instance && (
            <Button size="sm" variant="danger" onClick={() => { completeProtocol(instance.id); show('Protocol completed'); }}>✓ Complete</Button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        <div id="protocol-edit-section" className="bg-[#161B22] border border-[rgba(255,255,255,0.08)] rounded-2xl p-4 mb-5 flex flex-col gap-3">
          <div className="text-xs font-bold text-[#3B82F6] uppercase tracking-wide">Edit protocol</div>
          <Input label="Name" value={metaName} onChange={e => setMetaName(e.target.value)} />
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-[#8B949E] uppercase tracking-wide">Description</label>
            <textarea
              value={metaDescription}
              onChange={e => setMetaDescription(e.target.value)}
              rows={3}
              className="w-full bg-[#1C2333] border border-[rgba(255,255,255,0.08)] rounded-xl px-4 py-3 text-[#F0F6FC] text-sm outline-none focus:border-[#3B82F6] resize-none"
            />
          </div>
          <Select
            label="Category"
            value={metaCategory}
            onChange={e => setMetaCategory(e.target.value as ProtocolCategory)}
            options={CATEGORY_OPTIONS}
          />
          <div className="flex justify-end">
            <Button size="sm" onClick={saveProtocolMeta}>Save protocol details</Button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 mb-5">
          {[
            { label: 'Items', value: protocol.items.length },
            { label: 'Duration', value: protocol.durationDays ? `${protocol.durationDays}d` : '∞' },
            { label: 'Started', value: instance?.startDate ?? '—' },
          ].map(({ label, value }) => (
            <div key={label} className="bg-[#161B22] border border-[rgba(255,255,255,0.08)] rounded-xl p-3 text-center">
              <div className="text-base font-extrabold text-[#F0F6FC]">{value}</div>
              <div className="text-[11px] text-[#8B949E] mt-0.5">{label}</div>
            </div>
          ))}
        </div>
        <div className="bg-[#161B22] border border-[rgba(255,255,255,0.08)] rounded-2xl p-4 mb-5">
          <div className="text-xs font-bold text-[#8B949E] uppercase tracking-widest mb-3">Future plan</div>
          <div className="text-[12px] text-[#8B949E] mb-2">
            {detailReadModel.futureBoundaryDate
              ? `Fixed boundary: ${detailReadModel.futureBoundaryDate}`
              : 'Ongoing protocol (no fixed end boundary)'}
          </div>
          {detailReadModel.actionableFutureRows.length === 0 ? (
            <div className="text-sm text-[#8B949E]">No actionable future rows.</div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {detailReadModel.actionableFutureRows.slice(0, 5).map(dose => (
                <div key={dose.id} className="text-sm text-[#F0F6FC]">
                  {dose.scheduledDate} · {dose.scheduledTime} · {dose.protocolItem.name}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-[#161B22] border border-[rgba(255,255,255,0.08)] rounded-2xl p-4 mb-5">
          <div className="text-xs font-bold text-[#8B949E] uppercase tracking-widest mb-3">Handled history</div>
          {detailReadModel.handledHistoryRows.length === 0 ? (
            <div className="text-sm text-[#8B949E]">No handled history yet.</div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {detailReadModel.handledHistoryRows.slice(0, 5).map(dose => (
                <div key={dose.id} className="text-sm text-[#F0F6FC]">
                  {dose.scheduledDate} · {dose.scheduledTime} · {dose.protocolItem.name} · {dose.status}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-[#161B22] border border-[rgba(59,130,246,0.25)] rounded-2xl p-4 flex flex-col gap-3 mb-5">
          <div className="text-xs font-bold text-[#3B82F6] uppercase tracking-wide">
            {editingItem ? 'Edit item' : 'Add item'}
          </div>

          <Select
            label="Type"
            value={itemDraft.itemType}
            onChange={e => {
              const value = e.target.value as ProtocolItem['itemType'];
              setItemDraft(d => ({
                ...d,
                itemType: value,
                icon: value === 'analysis' ? '🧪' : value === 'therapy' ? '🩺' : '💊',
              }));
            }}
            options={[
              { value: 'medication', label: '💊 Medication' },
              { value: 'analysis', label: '🧪 Lab Analysis' },
              { value: 'therapy', label: '🩺 Therapy' },
            ]}
          />

          <Input label="Name" value={itemDraft.name} onChange={e => setItemDraft(d => ({ ...d, name: e.target.value }))} />

          {itemDraft.itemType === 'medication' && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  label="Amount"
                  type="number"
                  value={itemDraft.doseAmount}
                  onChange={e => setItemDraft(d => ({ ...d, doseAmount: e.target.value }))}
                />
                <Select
                  label="Unit"
                  value={itemDraft.doseUnit}
                  onChange={e => setItemDraft(d => ({ ...d, doseUnit: e.target.value }))}
                  options={['mg', 'mcg', 'IU', 'ml', 'units', 'g'].map(v => ({ value: v, label: v }))}
                />
              </div>
              <Select
                label="Form"
                value={itemDraft.doseForm}
                onChange={e => setItemDraft(d => ({ ...d, doseForm: e.target.value as DoseForm }))}
                options={[
                  { value: 'tablet',      label: `${DOSE_FORM_ICONS.tablet} Tablet` },
                  { value: 'capsule',     label: `${DOSE_FORM_ICONS.capsule} Capsule` },
                  { value: 'softgel',     label: `${DOSE_FORM_ICONS.softgel} Soft-gel` },
                  { value: 'injection',   label: `${DOSE_FORM_ICONS.injection} Injection` },
                  { value: 'cream',       label: `${DOSE_FORM_ICONS.cream} Cream / Gel` },
                  { value: 'drops',       label: `${DOSE_FORM_ICONS.drops} Drops` },
                  { value: 'powder',      label: `${DOSE_FORM_ICONS.powder} Powder` },
                  { value: 'liquid',      label: `${DOSE_FORM_ICONS.liquid} Liquid / Syrup` },
                  { value: 'patch',       label: `${DOSE_FORM_ICONS.patch} Patch` },
                  { value: 'inhaler',     label: `${DOSE_FORM_ICONS.inhaler} Inhaler` },
                  { value: 'spray',       label: `${DOSE_FORM_ICONS.spray} Spray` },
                  { value: 'eye_drops',   label: `${DOSE_FORM_ICONS.eye_drops} Eye drops` },
                  { value: 'nasal_spray', label: `${DOSE_FORM_ICONS.nasal_spray} Nasal spray` },
                  { value: 'suppository', label: `${DOSE_FORM_ICONS.suppository} Suppository` },
                  { value: 'lozenge',     label: `${DOSE_FORM_ICONS.lozenge} Lozenge` },
                  { value: 'other',       label: `${DOSE_FORM_ICONS.other} Other` },
                ]}
              />
              <Select
                label="Route"
                value={itemDraft.route}
                onChange={e => setItemDraft(d => ({ ...d, route: e.target.value as RouteOfAdmin }))}
                options={[
                  { value: 'oral',            label: `${ROUTE_ICONS.oral} Oral` },
                  { value: 'subcutaneous',    label: `${ROUTE_ICONS.subcutaneous} Subcutaneous` },
                  { value: 'intramuscular',   label: `${ROUTE_ICONS.intramuscular} Intramuscular` },
                  { value: 'topical',         label: `${ROUTE_ICONS.topical} Topical` },
                  { value: 'sublingual',      label: `${ROUTE_ICONS.sublingual} Sublingual` },
                  { value: 'inhalation',      label: `${ROUTE_ICONS.inhalation} Inhalation` },
                  { value: 'nasal',           label: `${ROUTE_ICONS.nasal} Nasal` },
                  { value: 'iv',              label: `${ROUTE_ICONS.iv} IV` },
                  { value: 'other',           label: `${ROUTE_ICONS.other} Other` },
                ]}
              />
              <Select
                label="With food"
                value={itemDraft.withFood}
                onChange={e => setItemDraft(d => ({ ...d, withFood: e.target.value as 'yes' | 'no' | 'any' }))}
                options={[
                  { value: 'any', label: 'No preference' },
                  { value: 'yes', label: 'With food' },
                  { value: 'no', label: 'Empty stomach' },
                ]}
              />
            </>
          )}

          <Select
            label="Frequency"
            value={itemDraft.frequencyType}
            onChange={e => setItemDraft(d => ({ ...d, frequencyType: e.target.value as FrequencyType }))}
            options={[
              { value: 'daily', label: 'Once daily' },
              { value: 'twice_daily', label: 'Twice daily' },
              { value: 'three_times_daily', label: 'Three times daily' },
              { value: 'every_n_days', label: 'Every N days' },
              { value: 'weekly', label: 'Weekly' },
            ]}
          />

          {itemDraft.frequencyType === 'every_n_days' && (
            <Input
              label="Every N days"
              type="number"
              value={itemDraft.frequencyValue}
              onChange={e => setItemDraft(d => ({ ...d, frequencyValue: String(Math.max(1, parseInt(e.target.value || '1', 10))) }))}
            />
          )}

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-[#8B949E] uppercase tracking-wide">Time</label>
            <input
              type="time"
              value={itemDraft.time}
              onChange={e => setItemDraft(d => ({ ...d, time: e.target.value }))}
              className="bg-[#1C2333] border border-[rgba(255,255,255,0.08)] rounded-xl px-4 py-3 text-[#F0F6FC] text-sm outline-none focus:border-[#3B82F6]"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-[#8B949E] uppercase tracking-wide">Instructions</label>
            <textarea
              value={itemDraft.instructions}
              onChange={e => setItemDraft(d => ({ ...d, instructions: e.target.value }))}
              rows={2}
              className="w-full bg-[#1C2333] border border-[rgba(255,255,255,0.08)] rounded-xl px-4 py-3 text-[#F0F6FC] text-sm outline-none focus:border-[#3B82F6] resize-none"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-[#8B949E] uppercase tracking-wide mb-2 block">Colour</label>
            <div className="flex gap-2">
              {COLORS.map(c => (
                <button
                  key={c}
                  onClick={() => setItemDraft(d => ({ ...d, color: c }))}
                  className={`w-7 h-7 rounded-full transition-all ${itemDraft.color === c ? 'scale-125 ring-2 ring-white/40' : ''}`}
                  style={{ background: COLOR_VALS[c] }}
                />
              ))}
            </div>
          </div>

          <div className="flex gap-2 justify-end">
            {editingItem && (
              <Button size="sm" variant="secondary" onClick={resetItemEditor}>Cancel</Button>
            )}
            <Button size="sm" onClick={saveItem}>{editingItem ? 'Save item' : '+ Add item'}</Button>
          </div>
        </div>

        <div className="text-xs font-bold text-[#8B949E] uppercase tracking-widest mb-3">Items</div>
        {protocol.items.length === 0 && (
          <div className="text-center py-8 text-sm text-[#8B949E]">No items yet. Use the editor above to add medications.</div>
        )}
        {protocol.items.map(item => (
          <ItemRow
            key={item.id}
            onEdit={() => openEditItem(item)}
            onDelete={() => handleDeleteItem(item)}
          >
            <div className="flex items-start gap-3">
              <span className="text-xl flex-shrink-0">{item.icon ?? '💊'}</span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-[#F0F6FC]">
                  {item.name} {item.doseAmount ? `${item.doseAmount}${item.doseUnit}` : ''}
                </div>
                <div className="text-xs text-[#8B949E] mt-0.5">
                  {frequencyLabel(item)} · {item.times.join(', ')}
                </div>
                <div className="flex gap-1.5 mt-2 flex-wrap">
                  {item.doseForm && (
                    <span className="text-[10px] bg-[rgba(255,255,255,0.05)] text-[#8B949E] px-2 py-0.5 rounded-full capitalize">{item.doseForm}</span>
                  )}
                  {item.route && (
                    <span className="text-[10px] bg-[rgba(255,255,255,0.05)] text-[#8B949E] px-2 py-0.5 rounded-full">{ROUTE_LABELS[item.route] ?? item.route}</span>
                  )}
                  {item.withFood === 'yes' && (
                    <span className="text-[10px] bg-[rgba(251,191,36,0.1)] text-[#FBBF24] px-2 py-0.5 rounded-full">With food</span>
                  )}
                  {item.withFood === 'no' && (
                    <span className="text-[10px] bg-[rgba(239,68,68,0.1)] text-[#EF4444] px-2 py-0.5 rounded-full">Empty stomach</span>
                  )}
                </div>
                {item.instructions && (
                  <div className="text-xs text-[#8B949E] mt-1.5 italic">{item.instructions}</div>
                )}
              </div>
            </div>
          </ItemRow>
        ))}

        <div className="mt-6 text-[11px] text-[#8B949E] bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-xl px-4 py-3 leading-relaxed">
          ⚠️ This protocol is for personal tracking purposes only. MedRemind does not provide medical advice. Always consult your healthcare provider before starting, modifying, or stopping any medication or supplement protocol.
        </div>
      </div>
    </div>
  );
}

function ItemRow({
  children,
  onEdit,
  onDelete,
}: {
  children: React.ReactNode;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [swiped, setSwiped] = useState(false);
  const touchStartX = useRef<number | null>(null);
  const mouseStartX = useRef<number | null>(null);

  return (
    <div
      className="relative overflow-hidden rounded-xl mb-2.5"
      onTouchStart={e => { touchStartX.current = e.touches[0].clientX; }}
      onTouchEnd={e => {
        if (touchStartX.current === null) return;
        const dx = touchStartX.current - e.changedTouches[0].clientX;
        if (dx > 50) setSwiped(true);
        if (dx < -30) setSwiped(false);
        touchStartX.current = null;
      }}
      onMouseDown={e => {
        mouseStartX.current = e.clientX;
      }}
      onMouseUp={e => {
        if (mouseStartX.current === null) return;
        const dx = mouseStartX.current - e.clientX;
        if (dx > 60) setSwiped(true);
        if (dx < -40) setSwiped(false);
        mouseStartX.current = null;
      }}
    >
      <div
        className={[
          'bg-[#161B22] border border-[rgba(255,255,255,0.08)] rounded-xl p-4 transition-all duration-200',
          swiped ? '-translate-x-[132px]' : '',
        ].join(' ')}
      >
        {children}
      </div>
      <div
        className={[
          'absolute right-0 top-0 bottom-0 flex items-stretch transition-transform duration-200',
          swiped ? 'translate-x-0' : 'translate-x-full',
        ].join(' ')}
      >
        <button
          onClick={() => { onEdit(); setSwiped(false); }}
          className="px-5 bg-[#3B82F6] text-white text-[11px] font-bold flex flex-col items-center justify-center gap-1"
        >
          ✏️<br />Edit
        </button>
        <button
          onClick={() => { onDelete(); setSwiped(false); }}
          className="px-5 bg-[#EF4444] text-white text-[11px] font-bold flex flex-col items-center justify-center gap-1 rounded-r-xl"
        >
          ✕<br />Delete
        </button>
      </div>
    </div>
  );
}
