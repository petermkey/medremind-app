'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import { useStore } from '@/lib/store/store';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import type { ProtocolCategory } from '@/types';

const CATEGORY_ICONS: Record<ProtocolCategory, string> = {
  general: '🌿', cardiovascular: '❤️', metabolic: '⚙️',
  hormonal: '🔬', neurological: '🧠', immune: '🛡️', custom: '✏️',
};

const FILTERS = [
  { value: 'all',       label: 'All' },
  { value: 'active',    label: 'Active' },
  { value: 'templates', label: 'Templates' },
  { value: 'custom',    label: 'My Protocols' },
];

export default function ProtocolsPage() {
  const router = useRouter();
  const { protocols, activeProtocols, activateProtocol, pauseProtocol, resumeProtocol, completeProtocol } = useStore();
  const { show } = useToast();
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');

  const filtered = protocols.filter(p => {
    if (p.isArchived) return false;
    if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
    const isActive = activeProtocols.some(ap => ap.protocolId === p.id && ap.status === 'active');
    if (filter === 'active') return isActive;
    if (filter === 'templates') return p.isTemplate;
    if (filter === 'custom') return !p.isTemplate;
    return true;
  });

  function getActiveInstance(protocolId: string) {
    return activeProtocols.find(ap => ap.protocolId === protocolId);
  }

  function handleActivate(protocolId: string) {
    const today = format(new Date(), 'yyyy-MM-dd');
    activateProtocol(protocolId, today);
    show('✓ Protocol activated');
  }

  function handleAction(protocolId: string, status: string, activeId: string) {
    if (status === 'active') { pauseProtocol(activeId); show('Protocol paused', 'warning'); }
    else if (status === 'paused') { resumeProtocol(activeId); show('Protocol resumed'); }
    else if (status === 'completed') { show('Protocol already completed', 'info'); }
    else handleActivate(protocolId);
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-5 pt-4 pb-3 flex-shrink-0">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-extrabold text-[#F0F6FC]">Protocols</h1>
          <button
            onClick={() => router.push('/app/protocols/new')}
            className="flex items-center gap-1.5 text-sm font-semibold text-[#3B82F6] border border-[rgba(59,130,246,0.3)] px-3 py-2 rounded-xl hover:bg-[rgba(59,130,246,0.1)] transition-colors"
          >
            ＋ New
          </button>
        </div>

        {/* Search */}
        <input
          type="text"
          placeholder="Search protocols…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full bg-[#1C2333] border border-[rgba(255,255,255,0.08)] rounded-xl px-4 py-2.5 text-sm text-[#F0F6FC] placeholder:text-[#8B949E] outline-none focus:border-[#3B82F6] mb-3"
        />

        {/* Filter tabs */}
        <div className="flex gap-2 overflow-x-auto pb-1">
          {FILTERS.map(f => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={[
                'px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-colors',
                filter === f.value ? 'bg-[#3B82F6] text-white' : 'bg-[#1C2333] text-[#8B949E] hover:text-[#F0F6FC]',
              ].join(' ')}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-5 pb-6">
        {filtered.length === 0 && (
          <div className="text-center py-16">
            <div className="text-4xl mb-3">📁</div>
            <div className="text-sm font-bold text-[#F0F6FC] mb-1">No protocols found</div>
            <div className="text-xs text-[#8B949E]">Try a different filter or create a custom protocol.</div>
          </div>
        )}

        {filtered.map(p => {
          const instance = getActiveInstance(p.id);
          const statusColor = !instance ? 'transparent' :
            instance.status === 'active' ? '#10B981' :
            instance.status === 'paused' ? '#FBBF24' : '#8B949E';

          return (
            <div
              key={p.id}
              className="bg-[#161B22] border border-[rgba(255,255,255,0.08)] rounded-2xl p-4 mb-3 cursor-pointer hover:border-[rgba(255,255,255,0.18)] transition-all duration-200"
              onClick={() => router.push(`/app/protocols/${p.id}`)}
            >
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-[rgba(59,130,246,0.12)] flex items-center justify-center text-xl flex-shrink-0">
                  {CATEGORY_ICONS[p.category] ?? '💊'}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-[#F0F6FC] truncate">{p.name}</span>
                    {instance && (
                      <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full" style={{ background: `${statusColor}20`, color: statusColor }}>
                        {instance.status}
                      </span>
                    )}
                    {p.isTemplate && !instance && (
                      <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-[rgba(139,92,246,0.15)] text-[#8B5CF6]">
                        template
                      </span>
                    )}
                  </div>
                  {p.description && (
                    <div className="text-xs text-[#8B949E] mt-0.5 line-clamp-2">{p.description}</div>
                  )}
                  <div className="flex items-center gap-3 mt-2">
                    <span className="text-[11px] text-[#8B949E]">{p.items.length} items</span>
                    {instance?.startDate && (
                      <span className="text-[11px] text-[#8B949E]">Started {instance.startDate}</span>
                    )}
                  </div>
                </div>

                {/* Action button */}
                <button
                  onClick={e => {
                    e.stopPropagation();
                    if (instance) handleAction(p.id, instance.status, instance.id);
                    else handleActivate(p.id);
                  }}
                  className={[
                    'text-xs font-semibold px-3 py-2 rounded-xl flex-shrink-0 transition-colors',
                    instance?.status === 'active'
                      ? 'bg-[rgba(251,191,36,0.15)] text-[#FBBF24] hover:bg-[rgba(251,191,36,0.25)]'
                      : instance?.status === 'paused'
                      ? 'bg-[rgba(16,185,129,0.15)] text-[#10B981] hover:bg-[rgba(16,185,129,0.25)]'
                      : 'bg-[rgba(59,130,246,0.15)] text-[#3B82F6] hover:bg-[rgba(59,130,246,0.25)]',
                  ].join(' ')}
                >
                  {instance?.status === 'active' ? 'Pause' :
                   instance?.status === 'paused' ? 'Resume' : 'Activate'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
