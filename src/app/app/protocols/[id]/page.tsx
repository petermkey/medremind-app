'use client';
import { use } from 'react';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import { useStore } from '@/lib/store/store';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';

const ROUTE_LABELS: Record<string, string> = {
  oral: 'Oral', subcutaneous: 'Subcut.', intramuscular: 'IM',
  topical: 'Topical', sublingual: 'Sublingual', inhalation: 'Inhaler', nasal: 'Nasal', iv: 'IV', other: 'Other',
};

export default function ProtocolDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { protocols, activeProtocols, activateProtocol, pauseProtocol, resumeProtocol, completeProtocol } = useStore();
  const { show } = useToast();

  const protocol = protocols.find(p => p.id === id);
  const instance = activeProtocols.find(ap => ap.protocolId === id);

  if (!protocol) return (
    <div className="flex flex-col items-center justify-center h-full gap-3">
      <div className="text-4xl">🤷</div>
      <div className="text-sm text-[#8B949E]">Protocol not found</div>
      <Button onClick={() => router.back()}>Go back</Button>
    </div>
  );

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
          <div key={item.id} className="bg-[#161B22] border border-[rgba(255,255,255,0.08)] rounded-xl p-4 mb-2.5">
            <div className="flex items-start gap-3">
              <span className="text-xl flex-shrink-0">{item.icon ?? '💊'}</span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-[#F0F6FC]">
                  {item.name} {item.doseAmount ? `${item.doseAmount}${item.doseUnit}` : ''}
                </div>
                <div className="text-xs text-[#8B949E] mt-0.5">
                  {item.frequencyType.replace(/_/g, ' ')} · {item.times.join(', ')}
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
          </div>
        ))}

        {/* Disclaimer */}
        <div className="mt-6 text-[11px] text-[#8B949E] bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-xl px-4 py-3 leading-relaxed">
          ⚠️ This protocol is for personal tracking purposes only. MedRemind does not provide medical advice. Always consult your healthcare provider before starting, modifying, or stopping any medication or supplement protocol.
        </div>
      </div>
    </div>
  );
}
