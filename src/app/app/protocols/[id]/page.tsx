'use client';
import { use, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import { useStore } from '@/lib/store/store';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import type { ProtocolItem } from '@/types';

const ROUTE_LABELS: Record<string, string> = {
  oral: 'Oral', subcutaneous: 'Subcut.', intramuscular: 'IM',
  topical: 'Topical', sublingual: 'Sublingual', inhalation: 'Inhaler', nasal: 'Nasal', iv: 'IV', other: 'Other',
};

function frequencyLabel(item: ProtocolItem) {
  if (item.frequencyType === 'every_n_days') {
    return `every ${item.frequencyValue ?? 1} days`;
  }
  return item.frequencyType.replace(/_/g, ' ');
}

export default function ProtocolDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const {
    protocols,
    activeProtocols,
    activateProtocol,
    pauseProtocol,
    resumeProtocol,
    completeProtocol,
    updateProtocol,
    removeProtocolItem,
    regenerateDoses,
  } = useStore();
  const { show } = useToast();
  const [editingItem, setEditingItem] = useState<ProtocolItem | null>(null);
  const [editName, setEditName] = useState('');
  const [editDoseAmount, setEditDoseAmount] = useState('');
  const [editDoseUnit, setEditDoseUnit] = useState('mg');
  const [editTime, setEditTime] = useState('08:00');
  const [editFrequencyType, setEditFrequencyType] = useState<ProtocolItem['frequencyType']>('daily');
  const [editFrequencyValue, setEditFrequencyValue] = useState('2');

  const protocol = protocols.find(p => p.id === id);
  const instance = activeProtocols.find(ap => ap.protocolId === id);
  const protocolId = protocol?.id;

  if (!protocol) return (
    <div className="flex flex-col items-center justify-center h-full gap-3">
      <div className="text-4xl">🤷</div>
      <div className="text-sm text-[#8B949E]">Protocol not found</div>
      <Button onClick={() => router.back()}>Go back</Button>
    </div>
  );

  function openEditItem(item: ProtocolItem) {
    setEditingItem(item);
    setEditName(item.name);
    setEditDoseAmount(item.doseAmount ? String(item.doseAmount) : '');
    setEditDoseUnit(item.doseUnit ?? 'mg');
    setEditTime(item.times[0] ?? '08:00');
    setEditFrequencyType(item.frequencyType);
    setEditFrequencyValue(String(item.frequencyValue ?? 2));
  }

  function saveEditItem() {
    if (!editingItem || !protocol) return;
    if (!editName.trim()) {
      show('Item name is required', 'warning');
      return;
    }
    const updatedItems = protocol.items.map(item => {
      if (item.id !== editingItem.id) return item;
      return {
        ...item,
        name: editName.trim(),
        doseAmount: editDoseAmount ? parseFloat(editDoseAmount) : undefined,
        doseUnit: editDoseUnit,
        frequencyType: editFrequencyType,
        frequencyValue: editFrequencyType === 'every_n_days' ? Math.max(1, parseInt(editFrequencyValue || '1', 10)) : undefined,
        times: [editTime],
      };
    });
    updateProtocol(protocol.id, { items: updatedItems });
    if (instance && instance.status === 'active') regenerateDoses(instance.id);
    show('✓ Item updated');
    setEditingItem(null);
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
          </div>
          {instance && (
            <span className="text-[11px] font-bold uppercase tracking-wide px-2 py-1 rounded-full flex-shrink-0" style={{ background: `${statusColor}20`, color: statusColor }}>
              {instance.status}
            </span>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2 mt-4">
          {!instance && (
            <Button size="sm" onClick={handleActivate}>▶ Activate</Button>
          )}
          {instance?.status === 'active' && (
            <Button size="sm" variant="secondary" onClick={() => { pauseProtocol(instance.id); show('Paused', 'warning'); }}>⏸ Pause</Button>
          )}
          {instance?.status === 'paused' && (
            <Button size="sm" onClick={() => { resumeProtocol(instance.id); show('Resumed'); }}>▶ Resume</Button>
          )}
          {instance?.status === 'active' && (
            <Button size="sm" variant="danger" onClick={() => { completeProtocol(instance.id); show('Protocol completed'); }}>✓ Complete</Button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        {/* Meta */}
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

        {/* Items */}
        <div className="text-xs font-bold text-[#8B949E] uppercase tracking-widest mb-3">Items</div>
        {protocol.items.length === 0 && (
          <div className="text-center py-8 text-sm text-[#8B949E]">No items yet. Edit this protocol to add medications.</div>
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

        {/* Disclaimer */}
        <div className="mt-6 text-[11px] text-[#8B949E] bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-xl px-4 py-3 leading-relaxed">
          ⚠️ This protocol is for personal tracking purposes only. MedRemind does not provide medical advice. Always consult your healthcare provider before starting, modifying, or stopping any medication or supplement protocol.
        </div>
      </div>

      {editingItem && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center sm:justify-center p-4">
          <div className="w-full sm:max-w-md bg-[#161B22] border border-[rgba(255,255,255,0.12)] rounded-2xl p-4 flex flex-col gap-3">
            <div className="text-sm font-bold text-[#F0F6FC]">Edit item</div>
            <Input label="Name" value={editName} onChange={e => setEditName(e.target.value)} />
            <div className="grid grid-cols-2 gap-2">
              <Input label="Amount" type="number" value={editDoseAmount} onChange={e => setEditDoseAmount(e.target.value)} />
              <Input label="Unit" value={editDoseUnit} onChange={e => setEditDoseUnit(e.target.value)} />
            </div>
            <Select
              label="Frequency"
              value={editFrequencyType}
              onChange={e => setEditFrequencyType(e.target.value as ProtocolItem['frequencyType'])}
              options={[
                { value: 'daily', label: 'Once daily' },
                { value: 'twice_daily', label: 'Twice daily' },
                { value: 'three_times_daily', label: 'Three times daily' },
                { value: 'every_n_days', label: 'Every N days' },
                { value: 'weekly', label: 'Weekly' },
              ]}
            />
            {editFrequencyType === 'every_n_days' && (
              <Input
                label="Every N days"
                type="number"
                value={editFrequencyValue}
                onChange={e => setEditFrequencyValue(String(Math.max(1, parseInt(e.target.value || '1', 10))))}
              />
            )}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-[#8B949E] uppercase tracking-wide">Time</label>
              <input
                type="time"
                value={editTime}
                onChange={e => setEditTime(e.target.value)}
                className="bg-[#1C2333] border border-[rgba(255,255,255,0.08)] rounded-xl px-4 py-3 text-[#F0F6FC] text-sm outline-none focus:border-[#3B82F6]"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="secondary" size="sm" onClick={() => setEditingItem(null)}>Cancel</Button>
              <Button size="sm" onClick={saveEditItem}>Save</Button>
            </div>
          </div>
        </div>
      )}
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
