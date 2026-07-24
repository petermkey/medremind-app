'use client';
import { useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import { useStore } from '@/lib/store/store';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import type { Protocol } from '@/types';
import { SEED_PROTOCOLS } from '@/lib/data/seed';

const FILTERS = [
  { value: 'active', label: 'Current' },
  { value: 'templates', label: 'Templates' },
  { value: 'custom', label: 'My protocols' },
  { value: 'all', label: 'All' },
];

export default function ProtocolsPage() {
  const router = useRouter();
  const {
    protocols,
    activeProtocols,
    scheduledDoses,
    doseRecords,
    activateProtocol,
    pauseProtocol,
    resumeProtocol,
    deleteProtocol,
  } = useStore();
  const { show } = useToast();
  const [filter, setFilter] = useState('active');
  const [search, setSearch] = useState('');

  const seedTemplateKeySet = new Set(
    SEED_PROTOCOLS.map(p => `${p.name.toLowerCase()}|${p.category}`),
  );

  const dedupedProtocols = (() => {
    const byDisplayKey = new Map<string, Protocol>();
    const isSeedProtocol = (id: string) => SEED_PROTOCOLS.some(p => p.id === id);
    const hasActiveInstance = (id: string) =>
      activeProtocols.some(ap => ap.protocolId === id && (ap.status === 'active' || ap.status === 'paused'));

    for (const p of protocols) {
      const templateKey = `${p.name.toLowerCase()}|${p.category}`;
      const displayKey = seedTemplateKeySet.has(templateKey)
        ? `template:${templateKey}`
        : `protocol:${p.id}`;
      const existing = byDisplayKey.get(displayKey);
      if (!existing) {
        byDisplayKey.set(displayKey, p);
        continue;
      }

      const pActive = hasActiveInstance(p.id);
      const existingActive = hasActiveInstance(existing.id);
      if (pActive && !existingActive) {
        byDisplayKey.set(displayKey, p);
        continue;
      }
      if (!pActive && !existingActive && isSeedProtocol(p.id) && !isSeedProtocol(existing.id)) {
        byDisplayKey.set(displayKey, p);
      }
    }

    return Array.from(byDisplayKey.values());
  })();

  const filtered = dedupedProtocols.filter(p => {
    if (p.isArchived && filter !== 'all') return false;
    if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
    const isCurrent = activeProtocols.some(
      ap => ap.protocolId === p.id && (ap.status === 'active' || ap.status === 'paused'),
    );
    if (filter === 'active') return isCurrent;
    if (filter === 'templates') return p.isTemplate;
    if (filter === 'custom') return !p.isTemplate && !p.isArchived;
    return true;
  });

  function getActiveInstance(protocolId: string) {
    return activeProtocols.find(ap =>
      ap.protocolId === protocolId && (ap.status === 'active' || ap.status === 'paused'),
    ) ?? activeProtocols.find(ap => ap.protocolId === protocolId);
  }

  function getStatusLabel(status: string) {
    return status === 'abandoned' ? 'archived' : status;
  }

  function handleActivate(protocolId: string) {
    const today = format(new Date(), 'yyyy-MM-dd');
    activateProtocol(protocolId, today);
    show('✓ Protocol activated');
  }

  function handleAction(protocolId: string, status: string, activeId: string) {
    if (status === 'active') {
      pauseProtocol(activeId);
      show('Protocol paused', 'warning');
      return;
    }
    if (status === 'paused') {
      resumeProtocol(activeId);
      show('Protocol resumed');
      return;
    }
    handleActivate(protocolId);
  }

  function handleDelete(protocol: Protocol) {
    if (protocol.isTemplate) {
      show('Template protocols cannot be deleted', 'warning');
      return;
    }
    const relatedActiveIds = activeProtocols
      .filter(ap => ap.protocolId === protocol.id)
      .map(ap => ap.id);
    const relatedDoses = scheduledDoses.filter(d => relatedActiveIds.includes(d.activeProtocolId));
    const relatedDoseIds = new Set(relatedDoses.map(d => d.id));
    const hasDoseRecordHistory = doseRecords.some(r => relatedDoseIds.has(r.scheduledDoseId));
    const hasHandledDoseStatus = relatedDoses.some(d =>
      d.status === 'taken' || d.status === 'skipped' || d.status === 'snoozed',
    );
    const willArchive = hasDoseRecordHistory || hasHandledDoseStatus;
    const confirmText = willArchive
      ? `Archive protocol "${protocol.name}" and keep history?`
      : `Delete protocol "${protocol.name}" permanently?`;
    if (!confirm(confirmText)) return;
    const result = deleteProtocol(protocol.id);
    if (result.mode === 'archived') {
      show('Protocol archived to preserve handled history', 'warning');
      return;
    }
    show('Protocol deleted', 'warning');
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-5 pt-4 pb-3 flex-shrink-0">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--muted)] mb-1">STACKS</div>
            <h1 className="text-xl font-semibold tracking-[-0.02em] text-[var(--text)]">Protocols</h1>
          </div>
          <button
            onClick={() => router.push('/app/protocols/new')}
            className="flex items-center gap-1.5 text-sm font-semibold text-[var(--blue-text)] border border-[rgba(var(--blue-rgb),0.3)] px-3 py-2 rounded-xl hover:bg-[rgba(var(--blue-rgb),0.1)] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--blue)] focus-visible:outline-offset-2"
          >
            ＋ New
          </button>
        </div>

        <input
          type="text"
          placeholder="Search protocols…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full bg-[var(--surface2)] border border-[rgba(var(--overlay-rgb),0.08)] rounded-xl px-4 py-2.5 text-sm text-[var(--text)] placeholder:text-[var(--muted)] outline-none focus:border-[var(--blue)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--blue)] focus-visible:outline-offset-2 mb-3"
        />

        <div className="flex gap-2 overflow-x-auto pb-1">
          {FILTERS.map(f => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={[
                'px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--blue)] focus-visible:outline-offset-2',
                filter === f.value ? 'bg-[var(--blue)] text-[var(--blue-on)]' : 'bg-[var(--surface2)] text-[var(--muted)] hover:text-[var(--text)]',
              ].join(' ')}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-6">
        {filtered.length === 0 && (
          <div className="text-center py-16">
            <div className="text-sm font-bold text-[var(--text)] mb-1">No protocols found</div>
            <div className="text-xs text-[var(--muted)]">Try a different filter or create a custom protocol.</div>
          </div>
        )}

        {filtered.map(p => {
          const instance = getActiveInstance(p.id);
          const statusColor = !instance
            ? 'transparent'
            : instance.status === 'active'
            ? 'var(--green)'
            : instance.status === 'paused'
            ? 'var(--yellow)'
            : 'var(--muted)';
          const statusBg = !instance
            ? 'transparent'
            : instance.status === 'active'
            ? 'rgba(var(--green-rgb),0.125)'
            : instance.status === 'paused'
            ? 'rgba(var(--yellow-rgb),0.125)'
            : 'rgba(var(--muted-rgb),0.125)';

          return (
            <ProtocolRow
              key={p.id}
              onOpen={() => router.push(`/app/protocols/${p.id}`)}
              onEdit={() => router.push(`/app/protocols/${p.id}?edit=1`)}
              onDelete={() => handleDelete(p)}
            >
              <div className="flex items-start gap-3" data-protocol-name={p.name}>
                <div className="flex-1 min-w-0">
                  <span className="block text-sm font-bold text-[var(--text)] truncate">{p.name}</span>
                  <div className="mt-1 flex items-center gap-2">
                    {p.isArchived ? (
                      <span className="text-[10px] font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-[rgba(var(--purple-rgb),0.15)] text-[var(--muted)] flex-shrink-0">
                        archived
                      </span>
                    ) : instance ? (
                      <span
                        className="text-[10px] font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded-full flex-shrink-0"
                        style={{ background: statusBg, color: statusColor }}
                      >
                        {getStatusLabel(instance.status)}
                      </span>
                    ) : null}
                    {p.isTemplate && !instance && (
                      <span className="text-[10px] font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-[rgba(var(--purple-rgb),0.15)] text-[var(--purple)] flex-shrink-0">
                        template
                      </span>
                    )}
                  </div>
                  {p.description && (
                    <div className="text-xs text-[var(--muted)] mt-0.5 line-clamp-2">{p.description}</div>
                  )}
                  <div className="flex items-center gap-3 mt-2">
                    <span className="text-[11px] font-mono tabular-nums text-[var(--muted)]">{p.items.length} items</span>
                    {instance?.startDate && (
                      <span className="text-[11px] font-mono tabular-nums text-[var(--muted)]">Started {instance.startDate}</span>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  aria-label={
                    instance?.status === 'active'
                      ? `Pause protocol ${p.name}`
                      : instance?.status === 'paused'
                      ? `Resume protocol ${p.name}`
                      : `Activate protocol ${p.name}`
                  }
                  onClick={e => {
                    e.stopPropagation();
                    if (instance) handleAction(p.id, instance.status, instance.id);
                    else handleActivate(p.id);
                  }}
                  className={[
                    'text-xs font-semibold px-3 py-2 rounded-xl border flex-shrink-0 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--blue)] focus-visible:outline-offset-2',
                    instance?.status === 'active'
                      ? 'bg-transparent border-[var(--border-strong)] text-[var(--muted)] hover:border-[var(--faint)] hover:text-[var(--text)]'
                      : instance?.status === 'paused'
                      ? 'bg-[rgba(var(--green-rgb),0.15)] border-transparent text-[var(--green)] hover:bg-[rgba(var(--green-rgb),0.25)]'
                      : 'bg-[rgba(var(--blue-rgb),0.15)] border-transparent text-[var(--blue-text)] hover:bg-[rgba(var(--blue-rgb),0.25)]',
                  ].join(' ')}
                >
                  {instance?.status === 'active' ? 'Pause' : instance?.status === 'paused' ? 'Resume' : 'Activate'}
                </button>
              </div>
            </ProtocolRow>
          );
        })}
      </div>
    </div>
  );
}

function ProtocolRow({
  children,
  onOpen,
  onEdit,
  onDelete,
}: {
  children: React.ReactNode;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [swiped, setSwiped] = useState(false);
  const touchStartX = useRef<number | null>(null);
  const mouseStartX = useRef<number | null>(null);
  const handleCardKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (!swiped) onOpen();
    }
  };

  return (
    <div
      className="relative overflow-hidden rounded-2xl mb-3"
      onTouchStart={e => {
        touchStartX.current = e.touches[0].clientX;
      }}
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
        role="button"
        tabIndex={0}
        onKeyDown={handleCardKeyDown}
        className={[
          'bg-[var(--surface)] border border-[rgba(var(--overlay-rgb),0.08)] rounded-2xl p-4 cursor-pointer hover:border-[rgba(var(--overlay-rgb),0.18)] transition-all duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--blue)] focus-visible:outline-offset-2',
          swiped ? '-translate-x-[132px]' : '',
        ].join(' ')}
        onClick={() => {
          if (!swiped) onOpen();
        }}
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
          type="button"
          aria-label="Edit protocol"
          onClick={e => {
            e.stopPropagation();
            onEdit();
            setSwiped(false);
          }}
          className="px-5 bg-[var(--blue)] text-[var(--blue-on)] text-[11px] font-bold flex flex-col items-center justify-center gap-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--text)] focus-visible:outline-offset-[-2px]"
        >
          Edit
        </button>
        <button
          type="button"
          aria-label="Delete protocol"
          onClick={e => {
            e.stopPropagation();
            onDelete();
            setSwiped(false);
          }}
          className="px-5 bg-[var(--red)] text-white text-[11px] font-bold flex flex-col items-center justify-center gap-1 rounded-r-2xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--text)] focus-visible:outline-offset-[-2px]"
        >
          Delete
        </button>
      </div>
    </div>
  );
}
