'use client';
import { useState, useMemo } from 'react';
import { StackGuardCard } from '@/components/app/StackGuardCard';
import { useStore } from '@/lib/store/store';

export default function MedsPage() {
  const { drugs, activeProtocols, protocols } = useStore();
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<'mine' | 'catalogue'>('mine');

  // Medications currently in active protocols
  const myMeds = useMemo(() => {
    const items: { name: string; doseAmount?: number; doseUnit?: string; protocolName: string; icon?: string }[] = [];
    for (const ap of activeProtocols) {
      if (ap.status !== 'active') continue;
      for (const item of ap.protocol.items) {
        if (item.itemType === 'medication') {
          items.push({ name: item.name, doseAmount: item.doseAmount, doseUnit: item.doseUnit, protocolName: ap.protocol.name, icon: item.icon });
        }
      }
    }
    return items;
  }, [activeProtocols]);

  const filteredDrugs = useMemo(() => {
    if (!search) return drugs.slice(0, 30);
    return drugs.filter(d => d.name.toLowerCase().includes(search.toLowerCase()) || d.genericName?.toLowerCase().includes(search.toLowerCase()));
  }, [drugs, search]);

  return (
    <div className="flex flex-col h-full">
      <div className="px-5 pt-4 pb-3 flex-shrink-0">
        <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--muted)] mb-1">MEDS · {myMeds.length} ACTIVE</div>
        <h1 className="text-xl font-semibold tracking-[-0.02em] text-[var(--text)] mb-4">Medications</h1>

        <input
          type="text"
          placeholder="Search medications…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full bg-[var(--surface2)] border border-[rgba(var(--overlay-rgb),0.08)] rounded-xl px-4 py-2.5 text-sm text-[var(--text)] placeholder:text-[var(--muted)] outline-none focus:border-[var(--blue)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--blue)] focus-visible:outline-offset-2 mb-3"
        />

        <div className="flex gap-2">
          {(['mine', 'catalogue'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-2 rounded-xl text-xs font-semibold border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--blue)] focus-visible:outline-offset-2 ${tab === t ? 'bg-[var(--blue)] border-[var(--blue)] text-[var(--blue-on)]' : 'bg-transparent border-[var(--border-strong)] text-[var(--muted)] hover:border-[var(--faint)] hover:text-[var(--text)]'}`}>
              {t === 'mine' ? 'My Meds' : 'Catalogue'}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-6">
        {tab === 'mine' && (
          <>
            <StackGuardCard />
            {myMeds.length === 0 ? (
              <div className="text-center py-16">
                <div className="text-sm font-bold text-[var(--text)] mb-1">No active medications</div>
                <div className="text-xs text-[var(--muted)]">Activate a protocol to see your medications here.</div>
              </div>
            ) : (
              myMeds
                .filter(m => !search || m.name.toLowerCase().includes(search.toLowerCase()))
                .map((med, i) => (
                  <div key={i} className="bg-[var(--surface)] border border-[rgba(var(--overlay-rgb),0.08)] rounded-xl p-4 mb-2.5">
                    <div className="text-sm font-bold text-[var(--text)]">
                      {med.name}{med.doseAmount ? <> <span className="font-mono tabular-nums">{med.doseAmount}{med.doseUnit}</span></> : null}
                    </div>
                    <div className="text-xs text-[var(--muted)] mt-0.5">{med.protocolName}</div>
                  </div>
                ))
            )}
          </>
        )}

        {tab === 'catalogue' && (
          <>
            <p className="text-xs text-[var(--muted)] mb-4">Reference database of {drugs.length} common medications and supplements.</p>
            {filteredDrugs.map(drug => (
              <div key={drug.id} className="bg-[var(--surface)] border border-[rgba(var(--overlay-rgb),0.08)] rounded-xl p-4 mb-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-bold text-[var(--text)]">{drug.name}</div>
                    {drug.genericName && drug.genericName !== drug.name && (
                      <div className="text-xs text-[var(--muted)] mt-0.5">{drug.genericName}</div>
                    )}
                    {drug.commonDoses && drug.commonDoses.length > 0 && (
                      <div className="text-xs text-[var(--muted)] mt-1">
                        Common doses: {drug.commonDoses.map(d => `${d.amount}${d.unit}`).join(', ')}
                      </div>
                    )}
                  </div>
                  {drug.category && (
                    <span className="font-mono text-[10px] font-semibold uppercase tracking-wide text-[var(--blue-text)] bg-[rgba(var(--blue-rgb),0.1)] px-2 py-1 rounded-full flex-shrink-0">
                      {drug.category}
                    </span>
                  )}
                </div>
                {drug.routes && drug.routes.length > 0 && (
                  <div className="flex gap-1 mt-2 flex-wrap">
                    {drug.routes.map(r => (
                      <span key={r} className="font-mono text-[10px] bg-[rgba(var(--overlay-rgb),0.05)] text-[var(--muted)] px-2 py-0.5 rounded-full capitalize">{r}</span>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {!search && drugs.length > 30 && (
              <p className="text-xs text-[var(--muted)] text-center py-3">Showing 30 of {drugs.length}. Search to filter.</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
