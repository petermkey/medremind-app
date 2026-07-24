'use client';
import { use, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { format } from 'date-fns';
import { useStore } from '@/lib/store/store';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import type { DoseForm, FrequencyType, ProtocolCategory, ProtocolItem, RouteOfAdmin } from '@/types';

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
  blue: 'var(--blue)', green: 'var(--green)', purple: 'var(--purple)',
  yellow: 'var(--yellow)', red: 'var(--red)', pink: 'var(--pink)',
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
    deleteProtocol,
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
        <div className="text-sm text-[var(--muted)]">Protocol not found</div>
        <Button onClick={() => router.back()} className="focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--blue)] focus-visible:outline-offset-2">Go back</Button>
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

  function getStatusLabel(status: string) {
    return status === 'abandoned' ? 'Archived' : status;
  }

  const statusColor = !instance ? 'var(--muted)' :
    instance.status === 'active' ? 'var(--green)' :
    instance.status === 'paused' ? 'var(--yellow)' : 'var(--muted)';
  const statusBg = !instance ? 'rgba(var(--muted-rgb),0.125)' :
    instance.status === 'active' ? 'rgba(var(--green-rgb),0.125)' :
    instance.status === 'paused' ? 'rgba(var(--yellow-rgb),0.125)' : 'rgba(var(--muted-rgb),0.125)';
  const courseFinishedWithoutClosure = Boolean(
    instance
    && instance.status === 'active'
    && instance.endDate
    && instance.endDate < todayStr
    && detailReadModel.actionableFutureRows.length === 0,
  );

  return (
    <div className="flex flex-col h-full">
      <div className="px-5 pt-4 pb-3 flex-shrink-0 border-b border-[rgba(var(--overlay-rgb),0.05)]">
        <button onClick={() => router.back()} className="text-[var(--muted)] text-xl mb-3 rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--blue)] focus-visible:outline-offset-2">← Back</button>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--muted)] mb-1">STACK</div>
            <h1 className="text-lg font-semibold tracking-[-0.02em] text-[var(--text)]">{protocol.name}</h1>
            {protocol.description && <p className="text-xs text-[var(--muted)] mt-1">{protocol.description}</p>}
            {detailReadModel.isArchived && <p className="text-[11px] font-mono text-[var(--yellow)] mt-1 uppercase tracking-wide font-bold">Archived</p>}
          </div>
          {instance && (
            <span className="text-[11px] font-mono font-bold uppercase tracking-wide px-2 py-1 rounded-full flex-shrink-0" style={{ background: statusBg, color: statusColor }}>
              {getStatusLabel(instance.status)}
            </span>
          )}
        </div>

        <div className="flex gap-2 mt-4">
          {detailReadModel.canActivate && (
            <Button size="sm" onClick={handleActivate} className="focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--blue)] focus-visible:outline-offset-2">Activate</Button>
          )}
          {detailReadModel.canPause && instance && (
            <Button size="sm" variant="secondary" onClick={() => { pauseProtocol(instance.id); show('Paused', 'warning'); }} className="focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--blue)] focus-visible:outline-offset-2">Pause</Button>
          )}
          {detailReadModel.canResume && instance && (
            <Button size="sm" onClick={() => { resumeProtocol(instance.id); show('Resumed'); }} className="focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--blue)] focus-visible:outline-offset-2">Resume</Button>
          )}
          {detailReadModel.canComplete && instance && (
            <Button size="sm" variant="danger" onClick={() => { completeProtocol(instance.id); show('Protocol completed'); }} className="focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--blue)] focus-visible:outline-offset-2">Complete</Button>
          )}
          {!protocol.isTemplate && (
            <Button
              size="sm"
              variant="danger"
              aria-label="Delete protocol"
              data-testid="delete-protocol-button"
              className="focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--blue)] focus-visible:outline-offset-2"
              onClick={() => {
                const confirmText = protocol.isArchived
                  ? `Archive this protocol and keep history?`
                  : `Delete protocol "${protocol.name}"?`;
                if (!confirm(confirmText)) return;
                const result = deleteProtocol(protocol.id);
                if (result.mode === 'archived') {
                  show('Protocol archived to preserve history', 'warning');
                } else {
                  show('Protocol deleted', 'warning');
                }
                router.replace('/app/protocols');
              }}
            >
              Delete
            </Button>
          )}
        </div>

        {courseFinishedWithoutClosure && instance && (
          <div className="mt-3 bg-[rgba(var(--yellow-rgb),0.12)] border border-[rgba(var(--yellow-rgb),0.35)] rounded-xl p-3">
            <div className="text-xs font-mono font-bold text-[var(--yellow)] uppercase tracking-wide mb-1">Course finished</div>
            <div className="text-sm text-[var(--text)]">
              This course reached its end date. Mark as completed, or keep it active for history context.
            </div>
            {detailReadModel.canComplete && (
              <div className="mt-2">
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => { completeProtocol(instance.id); show('Protocol completed'); }}
                  className="focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--blue)] focus-visible:outline-offset-2"
                >
                  Mark completed
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        <div id="protocol-edit-section" className="bg-[var(--surface)] border border-[rgba(var(--overlay-rgb),0.08)] rounded-2xl p-4 mb-5 flex flex-col gap-3">
          <div className="text-xs font-mono font-bold text-[var(--blue-text)] uppercase tracking-wide">Edit protocol</div>
          <Input label="Name" value={metaName} onChange={e => setMetaName(e.target.value)} />
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-mono font-semibold text-[var(--muted)] uppercase tracking-wide">Description</label>
            <textarea
              value={metaDescription}
              onChange={e => setMetaDescription(e.target.value)}
              rows={3}
              className="w-full bg-[var(--surface2)] border border-[rgba(var(--overlay-rgb),0.08)] rounded-xl px-4 py-3 text-[var(--text)] text-sm outline-none focus:border-[var(--blue)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--blue)] focus-visible:outline-offset-2 resize-none"
            />
          </div>
          <Select
            label="Category"
            value={metaCategory}
            onChange={e => setMetaCategory(e.target.value as ProtocolCategory)}
            options={CATEGORY_OPTIONS}
          />
          <div className="flex justify-end">
            <Button size="sm" onClick={saveProtocolMeta} className="focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--blue)] focus-visible:outline-offset-2">Save protocol details</Button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 mb-5">
          {[
            { label: 'Items', value: protocol.items.length },
            { label: 'Duration', value: protocol.durationDays ? `${protocol.durationDays}d` : '∞' },
            { label: 'Started', value: instance?.startDate ?? '—' },
          ].map(({ label, value }) => (
            <div key={label} className="bg-[var(--surface)] border border-[rgba(var(--overlay-rgb),0.08)] rounded-xl p-3 text-center">
              <div className="text-base font-mono tabular-nums font-extrabold text-[var(--text)]">{value}</div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--muted)] mt-0.5">{label}</div>
            </div>
          ))}
        </div>

        <div className="bg-[var(--surface)] border border-[rgba(var(--overlay-rgb),0.08)] rounded-2xl p-4 mb-5">
          <div className="text-[10px] font-mono font-bold text-[var(--muted)] uppercase tracking-wider mb-3">Future plan</div>
          <div className="text-[12px] text-[var(--muted)] mb-2">
            {detailReadModel.futureBoundaryDate
              ? <>Fixed boundary: <span className="font-mono tabular-nums">{detailReadModel.futureBoundaryDate}</span></>
              : 'Ongoing protocol (no fixed end boundary)'}
          </div>
          {detailReadModel.actionableFutureRows.length === 0 ? (
            <div className="text-sm text-[var(--muted)]">No actionable future rows.</div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {detailReadModel.actionableFutureRows.slice(0, 5).map(dose => (
                <div key={dose.id} className="text-sm text-[var(--text)]">
                  <span className="font-mono tabular-nums">{dose.scheduledDate} · {dose.scheduledTime}</span> · {dose.protocolItem.name}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-[var(--surface)] border border-[rgba(var(--overlay-rgb),0.08)] rounded-2xl p-4 mb-5">
          <div className="text-[10px] font-mono font-bold text-[var(--muted)] uppercase tracking-wider mb-3">Handled history</div>
          {detailReadModel.handledHistoryRows.length === 0 ? (
            <div className="text-sm text-[var(--muted)]">No handled history yet.</div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {detailReadModel.handledHistoryRows.slice(0, 5).map(dose => (
                <div key={dose.id} className="text-sm text-[var(--text)]">
                  <span className="font-mono tabular-nums">{dose.scheduledDate} · {dose.scheduledTime}</span> · {dose.protocolItem.name} · {dose.status}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-[var(--surface)] border border-[rgba(var(--blue-rgb),0.25)] rounded-2xl p-4 flex flex-col gap-3 mb-5">
          <div className="text-xs font-mono font-bold text-[var(--blue-text)] uppercase tracking-wide">
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
              { value: 'medication', label: 'Medication' },
              { value: 'analysis', label: 'Lab Analysis' },
              { value: 'therapy', label: 'Therapy' },
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
                  { value: 'tablet',      label: 'Tablet' },
                  { value: 'capsule',     label: 'Capsule' },
                  { value: 'softgel',     label: 'Soft-gel' },
                  { value: 'injection',   label: 'Injection' },
                  { value: 'cream',       label: 'Cream / Gel' },
                  { value: 'drops',       label: 'Drops' },
                  { value: 'powder',      label: 'Powder' },
                  { value: 'liquid',      label: 'Liquid / Syrup' },
                  { value: 'patch',       label: 'Patch' },
                  { value: 'inhaler',     label: 'Inhaler' },
                  { value: 'spray',       label: 'Spray' },
                  { value: 'eye_drops',   label: 'Eye drops' },
                  { value: 'nasal_spray', label: 'Nasal spray' },
                  { value: 'suppository', label: 'Suppository' },
                  { value: 'lozenge',     label: 'Lozenge' },
                  { value: 'other',       label: 'Other' },
                ]}
              />
              <Select
                label="Route"
                value={itemDraft.route}
                onChange={e => setItemDraft(d => ({ ...d, route: e.target.value as RouteOfAdmin }))}
                options={[
                  { value: 'oral',            label: 'Oral' },
                  { value: 'subcutaneous',    label: 'Subcutaneous' },
                  { value: 'intramuscular',   label: 'Intramuscular' },
                  { value: 'topical',         label: 'Topical' },
                  { value: 'sublingual',      label: 'Sublingual' },
                  { value: 'inhalation',      label: 'Inhalation' },
                  { value: 'nasal',           label: 'Nasal' },
                  { value: 'iv',              label: 'IV' },
                  { value: 'other',           label: 'Other' },
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
            <label className="text-xs font-mono font-semibold text-[var(--muted)] uppercase tracking-wide">Time</label>
            <input
              type="time"
              value={itemDraft.time}
              onChange={e => setItemDraft(d => ({ ...d, time: e.target.value }))}
              className="bg-[var(--surface2)] border border-[rgba(var(--overlay-rgb),0.08)] rounded-xl px-4 py-3 text-[var(--text)] text-sm font-mono tabular-nums outline-none focus:border-[var(--blue)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--blue)] focus-visible:outline-offset-2"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-mono font-semibold text-[var(--muted)] uppercase tracking-wide">Instructions</label>
            <textarea
              value={itemDraft.instructions}
              onChange={e => setItemDraft(d => ({ ...d, instructions: e.target.value }))}
              rows={2}
              className="w-full bg-[var(--surface2)] border border-[rgba(var(--overlay-rgb),0.08)] rounded-xl px-4 py-3 text-[var(--text)] text-sm outline-none focus:border-[var(--blue)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--blue)] focus-visible:outline-offset-2 resize-none"
            />
          </div>

          <div>
            <label className="text-xs font-mono font-semibold text-[var(--muted)] uppercase tracking-wide mb-2 block">Colour</label>
            <div className="flex gap-2">
              {COLORS.map(c => (
                <button
                  key={c}
                  onClick={() => setItemDraft(d => ({ ...d, color: c }))}
                  className={`w-7 h-7 rounded-full transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--blue)] focus-visible:outline-offset-2 ${itemDraft.color === c ? 'scale-125 ring-2 ring-white/40' : ''}`}
                  style={{ background: COLOR_VALS[c] }}
                />
              ))}
            </div>
          </div>

          <div className="flex gap-2 justify-end">
            {editingItem && (
              <Button size="sm" variant="secondary" onClick={resetItemEditor} className="focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--blue)] focus-visible:outline-offset-2">Cancel</Button>
            )}
            <Button size="sm" onClick={saveItem} className="focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--blue)] focus-visible:outline-offset-2">{editingItem ? 'Save item' : '+ Add item'}</Button>
          </div>
        </div>

        <div className="text-[10px] font-mono font-bold text-[var(--muted)] uppercase tracking-wider mb-3">Items</div>
        {protocol.items.length === 0 && (
          <div className="text-center py-8 text-sm text-[var(--muted)]">No items yet. Use the editor above to add medications.</div>
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
                <div className="text-sm font-bold text-[var(--text)]">
                  {item.name} {item.doseAmount ? <span className="font-mono tabular-nums">{item.doseAmount}{item.doseUnit}</span> : ''}
                </div>
                <div className="text-xs text-[var(--muted)] mt-0.5">
                  {frequencyLabel(item)} · <span className="font-mono tabular-nums">{item.times.join(', ')}</span>
                </div>
                <div className="flex gap-1.5 mt-2 flex-wrap">
                  {item.doseForm && (
                    <span className="font-mono text-[10px] uppercase tracking-wide bg-[rgba(var(--overlay-rgb),0.05)] text-[var(--muted)] px-2 py-0.5 rounded-full">{item.doseForm}</span>
                  )}
                  {item.route && (
                    <span className="font-mono text-[10px] uppercase tracking-wide bg-[rgba(var(--overlay-rgb),0.05)] text-[var(--muted)] px-2 py-0.5 rounded-full">{ROUTE_LABELS[item.route] ?? item.route}</span>
                  )}
                  {item.withFood === 'yes' && (
                    <span className="font-mono text-[10px] uppercase tracking-wide bg-[rgba(var(--yellow-rgb),0.1)] text-[var(--yellow)] px-2 py-0.5 rounded-full">With food</span>
                  )}
                  {item.withFood === 'no' && (
                    <span className="font-mono text-[10px] uppercase tracking-wide bg-[rgba(var(--red-rgb),0.1)] text-[var(--red)] px-2 py-0.5 rounded-full">Empty stomach</span>
                  )}
                </div>
                {item.instructions && (
                  <div className="text-xs text-[var(--muted)] mt-1.5 italic">{item.instructions}</div>
                )}
              </div>
            </div>
          </ItemRow>
        ))}

        <div className="mt-6 text-[11px] text-[var(--muted)] bg-[var(--surface)] border border-[rgba(var(--overlay-rgb),0.08)] rounded-xl px-4 py-3 leading-relaxed">
          This protocol is for personal tracking purposes only. MedRemind does not provide medical advice. Always consult your healthcare provider before starting, modifying, or stopping any medication or supplement protocol.
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
          'bg-[var(--surface)] border border-[rgba(var(--overlay-rgb),0.08)] rounded-xl p-4 transition-all duration-200',
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
          className="px-5 bg-[var(--blue)] text-[var(--blue-on)] text-[11px] font-mono font-bold uppercase tracking-wide flex flex-col items-center justify-center gap-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--text)] focus-visible:outline-offset-[-2px]"
        >
          Edit
        </button>
        <button
          onClick={() => { onDelete(); setSwiped(false); }}
          className="px-5 bg-[var(--red)] text-white text-[11px] font-mono font-bold uppercase tracking-wide flex flex-col items-center justify-center gap-1 rounded-r-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--text)] focus-visible:outline-offset-[-2px]"
        >
          Delete
        </button>
      </div>
    </div>
  );
}
