'use client';
import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
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
  onDelete: () => void;
  actionsDisabled?: boolean;
  takenAt?: string; // ISO timestamp of actual intake
}

function fmt(t: string) {
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

function deriveDisplayStatus(dose: ScheduledDose): string {
  if (dose.status !== 'pending') return dose.status;
  const now = new Date();
  const todayStr = now.toLocaleDateString('en-CA'); // YYYY-MM-DD in local tz
  const timeStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  const isPast = dose.scheduledDate < todayStr ||
    (dose.scheduledDate === todayStr && dose.scheduledTime < timeStr);
  return isPast ? 'overdue' : 'pending';
}

export function MedCard({ dose, onTake, onSkip, onSnooze, onDelete, actionsDisabled = false, takenAt }: Props) {
  const item = dose.protocolItem;
  const color = COLOR_MAP[item.color ?? 'blue'] ?? COLOR_MAP.blue;
  const displayStatus = deriveDisplayStatus(dose);
  const statusColor = STATUS_COLOR[displayStatus] ?? '#8B949E';
  const [swipeDir, setSwipeDir] = useState<'left' | 'right' | null>(null);
  const gesture = useRef<{
    pointerId: number | null;
    startX: number;
    startY: number;
  }>({
    pointerId: null,
    startX: 0,
    startY: 0,
  });

  const resetGesture = () => {
    gesture.current.pointerId = null;
    gesture.current.startX = 0;
    gesture.current.startY = 0;
  };

  useEffect(() => {
    setSwipeDir(null);
  }, [dose.id]);

  useEffect(() => {
    if (actionsDisabled) setSwipeDir(null);
  }, [actionsDisabled]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ doseId?: string }>).detail;
      if (detail?.doseId && detail.doseId !== dose.id) {
        setSwipeDir(null);
      }
    };
    window.addEventListener('med-card-open', handler as EventListener);
    return () => window.removeEventListener('med-card-open', handler as EventListener);
  }, [dose.id]);

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
    gesture.current.pointerId = e.pointerId;
    gesture.current.startX = e.clientX;
    gesture.current.startY = e.clientY;
  };

  const handlePointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (gesture.current.pointerId !== e.pointerId) return;
    const dx = gesture.current.startX - e.clientX;
    const dy = Math.abs(gesture.current.startY - e.clientY);
    resetGesture();

    // Let vertical scroll gestures pass through without opening swipe actions.
    if (dy > 24 && dy > Math.abs(dx)) return;
    if (actionsDisabled) {
      if (Math.abs(dx) > 30) onSnooze();
      return;
    }
    if (dx > 50) {
      // Swipe LEFT → Delete panel
      setSwipeDir('left');
      window.dispatchEvent(new CustomEvent('med-card-open', { detail: { doseId: dose.id } }));
    } else if (dx < -50) {
      // Swipe RIGHT → Snooze/Skip panel
      setSwipeDir('right');
      window.dispatchEvent(new CustomEvent('med-card-open', { detail: { doseId: dose.id } }));
    } else if (Math.abs(dx) < 30) {
      setSwipeDir(null);
    }
  };

  const tags: string[] = [];
  if (item.withFood === 'yes') tags.push('With food');
  if (item.withFood === 'no') tags.push('Empty stomach');
  if (item.route === 'subcutaneous') tags.push('Subcut.');
  if (item.route === 'intramuscular') tags.push('IM');
  if (item.itemType === 'analysis') tags.push('Lab test');

  const cardTranslate =
    swipeDir === 'left'  ? '-translate-x-[90px]' :
    swipeDir === 'right' ? 'translate-x-[130px]' : '';

  return (
    <div
      className="relative overflow-hidden rounded-[18px] mb-2.5"
      data-dose-id={dose.id}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={resetGesture}
      style={{ touchAction: 'pan-y' }}
    >
      {/* Snooze/Skip panel — left side, revealed by swipe RIGHT */}
      <div
        className={[
          'absolute left-0 top-0 bottom-0 flex items-stretch transition-transform duration-200',
          swipeDir === 'right' ? 'translate-x-0' : '-translate-x-full',
        ].join(' ')}
      >
        <button
          type="button"
          aria-label={`Snooze ${item.name}`}
          aria-disabled={actionsDisabled}
          onClick={() => {
            onSnooze();
            setSwipeDir(null);
          }}
          className={[
            'px-5 bg-[#FBBF24] text-black text-[11px] font-bold flex flex-col items-center justify-center gap-1 rounded-l-[18px]',
            actionsDisabled ? 'opacity-50 cursor-not-allowed' : '',
          ].join(' ')}
        >
          ⏰<br />Snooze
        </button>
        <button
          type="button"
          aria-label={`Skip ${item.name}`}
          aria-disabled={actionsDisabled}
          onClick={() => {
            onSkip();
            setSwipeDir(null);
          }}
          className={[
            'px-5 bg-[#EF4444] text-white text-[11px] font-bold flex flex-col items-center justify-center gap-1',
            actionsDisabled ? 'opacity-50 cursor-not-allowed' : '',
          ].join(' ')}
        >
          ✕<br />Skip
        </button>
      </div>

      {/* Card */}
      <div
        className={[
          'bg-[#161B22] border border-[rgba(255,255,255,0.08)] rounded-[18px] px-4 py-4',
          'flex items-center gap-3.5 transition-all duration-200 relative overflow-hidden',
          cardTranslate,
          actionsDisabled ? 'opacity-70' : displayStatus === 'taken' ? 'opacity-60' : '',
        ].join(' ')}
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
            {displayStatus === 'taken' && takenAt
              ? (() => {
                  const d = new Date(takenAt);
                  const hh = String(d.getHours()).padStart(2, '0');
                  const mm = String(d.getMinutes()).padStart(2, '0');
                  return `✓ Taken at ${fmt(`${hh}:${mm}`)}`;
                })()
              : `${STATUS_LABEL[displayStatus] ?? STATUS_LABEL[dose.status]} · ${fmt(dose.scheduledTime)}`}
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
          type="button"
          aria-label={displayStatus === 'taken' ? 'Already marked as taken' : 'Mark as taken'}
          onClick={e => {
            e.stopPropagation();
            if (dose.status !== 'taken') onTake();
          }}
          aria-disabled={actionsDisabled}
          className={[
            'w-9 h-9 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all duration-200 text-base',
            actionsDisabled ? 'opacity-50 cursor-not-allowed' : '',
            displayStatus === 'taken'
              ? 'bg-[#10B981] border-[#10B981] text-white cursor-default'
              : displayStatus === 'overdue'
              ? 'border-[#EF4444] text-[#EF4444] hover:bg-[#EF4444] hover:text-white'
              : 'border-[rgba(255,255,255,0.15)] text-[#8B949E] hover:border-[#10B981] hover:text-[#10B981]',
          ].join(' ')}
        >
          {displayStatus === 'taken' ? '✓' : ''}
        </button>
      </div>

      {/* Delete panel — right side, revealed by swipe LEFT */}
      <div
        className={[
          'absolute right-0 top-0 bottom-0 flex items-stretch transition-transform duration-200',
          swipeDir === 'left' ? 'translate-x-0' : 'translate-x-full',
        ].join(' ')}
      >
        <button
          type="button"
          aria-label={`Delete ${item.name}`}
          onClick={() => {
            onDelete();
            setSwipeDir(null);
          }}
          className="px-5 bg-[#7F1D1D] text-white text-[11px] font-bold flex flex-col items-center justify-center gap-1 rounded-r-[18px]"
        >
          🗑<br />Delete
        </button>
      </div>
    </div>
  );
}
