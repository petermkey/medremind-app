'use client';
import { useRef, useState } from 'react';
import type { ScheduledDose } from '@/types';

const COLOR_MAP: Record<string, { bg: string; text: string }> = {
  red:    { bg: 'rgba(239,68,68,0.15)',   text: '#EF4444' },
  blue:   { bg: 'rgba(59,130,246,0.15)',  text: '#3B82F6' },
  green:  { bg: 'rgba(16,185,129,0.15)',  text: '#10B981' },
  yellow: { bg: 'rgba(251,191,36,0.15)',  text: '#FBBF24' },
  purple: { bg: 'rgba(139,92,246,0.15)',  text: '#8B5CF6' },
  pink:   { bg: 'rgba(236,72,153,0.15)',  text: '#EC4899' },
};

const STATUS_COLOR: Record<string, string> = {
  taken:     '#10B981',
  upcoming:  '#3B82F6',
  overdue:   '#EF4444',
  skipped:   '#8B949E',
  snoozed:   '#FBBF24',
  pending:   '#3B82F6',
};

const STATUS_LABEL: Record<string, string> = {
  taken:    '✓ Taken',
  upcoming: 'Upcoming',
  overdue:  '⚠ Overdue',
  skipped:  '— Skipped',
  snoozed:  '⏰ Snoozed',
  pending:  'Scheduled',
};

interface Props {
  dose: ScheduledDose;
  onTake: () => void;
  onSkip: () => void;
  onSnooze: () => void;
}

function fmt(t: string) {
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

export function MedCard({ dose, onTake, onSkip, onSnooze }: Props) {
  const item = dose.protocolItem;
  const color = COLOR_MAP[item.color ?? 'blue'] ?? COLOR_MAP.blue;
  const statusColor = STATUS_COLOR[dose.status] ?? '#8B949E';
  const [swiped, setSwiped] = useState(false);
  const touchStartX = useRef<number | null>(null);

  const tags: string[] = [];
  if (item.withFood === 'yes') tags.push('With food');
  if (item.withFood === 'no') tags.push('Empty stomach');
  if (item.route === 'subcutaneous') tags.push('Subcut.');
  if (item.route === 'intramuscular') tags.push('IM');
  if (item.itemType === 'analysis') tags.push('Lab test');

  return (
    <div
      className="relative overflow-hidden rounded-[18px] mb-2.5"
      onTouchStart={e => { touchStartX.current = e.touches[0].clientX; }}
      onTouchEnd={e => {
        if (touchStartX.current === null) return;
        const dx = touchStartX.current - e.changedTouches[0].clientX;
        if (dx > 50) setSwiped(true);
        if (dx < -30) setSwiped(false);
        touchStartX.current = null;
      }}
    >
      {/* Card */}
      <div
        className={[
          'bg-[#161B22] border border-[rgba(255,255,255,0.08)] rounded-[18px] px-4 py-4',
          'flex items-center gap-3.5 transition-all duration-200 relative overflow-hidden',
          swiped ? '-translate-x-[130px]' : '',
          dose.status === 'taken' ? 'opacity-60' : '',
        ].join(' ')}
        style={{ borderRadius: swiped ? '18px 0 0 18px' : undefined }}
      >
        {/* Status stripe */}
        <div className="absolute left-0 top-0 bottom-0 w-[3px] rounded-r-sm" style={{ background: statusColor }} />

        {/* Icon */}
        <div
          className="w-11 h-11 rounded-[14px] flex items-center justify-center text-[22px] flex-shrink-0"
          style={{ background: color.bg }}
        >
          {item.icon ?? '💊'}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold text-[#F0F6FC] truncate">
            {item.name} {item.doseAmount ? `${item.doseAmount}${item.doseUnit}` : ''}
          </div>
          <div className="text-xs mt-0.5" style={{ color: statusColor }}>
            {STATUS_LABEL[dose.status]} · {fmt(dose.scheduledTime)}
          </div>
          {tags.length > 0 && (
            <div className="flex gap-1.5 mt-1.5 flex-wrap">
              {tags.map(tag => (
                <span key={tag} className="text-[10px] font-semibold px-2 py-0.5 rounded-[6px] bg-[rgba(255,255,255,0.06)] text-[#8B949E]">
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Check button */}
        <button
          onClick={e => { e.stopPropagation(); dose.status !== 'taken' ? onTake() : onSkip(); }}
          className={[
            'w-9 h-9 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all duration-200 text-base',
            dose.status === 'taken'
              ? 'bg-[#10B981] border-[#10B981] text-white'
              : dose.status === 'overdue'
              ? 'border-[#EF4444] text-[#EF4444] hover:bg-[#EF4444] hover:text-white'
              : 'border-[rgba(255,255,255,0.15)] text-[#8B949E] hover:border-[#10B981] hover:text-[#10B981]',
          ].join(' ')}
        >
          {dose.status === 'taken' ? '✓' : ''}
        </button>
      </div>

      {/* Swipe actions */}
      <div
        className={[
          'absolute right-0 top-0 bottom-0 flex items-stretch transition-transform duration-200',
          swiped ? 'translate-x-0' : 'translate-x-full',
        ].join(' ')}
      >
        <button
          onClick={() => { onSnooze(); setSwiped(false); }}
          className="px-5 bg-[#FBBF24] text-black text-[11px] font-bold flex flex-col items-center justify-center gap-1"
        >
          ⏰<br />Snooze
        </button>
        <button
          onClick={() => { onSkip(); setSwiped(false); }}
          className="px-5 bg-[#EF4444] text-white text-[11px] font-bold flex flex-col items-center justify-center gap-1 rounded-r-[18px]"
        >
          ✕<br />Skip
        </button>
      </div>
    </div>
  );
}
