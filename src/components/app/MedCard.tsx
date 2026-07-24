'use client';
import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { ScheduledDose } from '@/types';

const STATUS_COLOR: Record<string, string> = {
  taken:     '#8fae74',
  upcoming:  '#d9a53f',
  overdue:   '#c96a5a',
  skipped:   '#9b978f',
  snoozed:   '#cf8148',
  pending:   '#d9a53f',
};

const STATUS_LABEL: Record<string, string> = {
  taken:    'Taken',
  upcoming: 'Upcoming',
  overdue:  'Overdue',
  skipped:  'Skipped',
  snoozed:  'Snoozed',
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
  smartAdjustedTime?: string | null; // W4-A: today's push was shifted to this HH:MM
  isNext?: boolean; // presentational only: emphasized panel for the next upcoming dose
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

export function MedCard({ dose, onTake, onSkip, onSnooze, onDelete, actionsDisabled = false, takenAt, smartAdjustedTime, isNext = false }: Props) {
  const item = dose.protocolItem;
  const displayStatus = deriveDisplayStatus(dose);
  const settled = displayStatus === 'taken' || displayStatus === 'skipped';
  const statusColor = STATUS_COLOR[displayStatus] ?? '#9b978f';
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
  if (smartAdjustedTime) tags.push(`${fmt(smartAdjustedTime)} · adjusted`);

  const cardTranslate =
    swipeDir === 'left'  ? '-translate-x-[90px]' :
    swipeDir === 'right' ? 'translate-x-[130px]' : '';

  return (
    <div
      className={`relative overflow-hidden rounded-[14px] ${settled ? 'mb-1' : isNext ? 'mb-2.5' : 'mb-1.5'}`}
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
            'px-5 bg-[#cf8148] text-[#14120b] font-mono text-[10px] font-bold uppercase tracking-wider flex items-center justify-center rounded-l-[14px]',
            'focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#e8e6e1] focus-visible:outline-offset-[-2px]',
            actionsDisabled ? 'opacity-50 cursor-not-allowed' : '',
          ].join(' ')}
        >
          Snooze
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
            'px-5 bg-[#c96a5a] text-white font-mono text-[10px] font-bold uppercase tracking-wider flex items-center justify-center',
            'focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#e8e6e1] focus-visible:outline-offset-[-2px]',
            actionsDisabled ? 'opacity-50 cursor-not-allowed' : '',
          ].join(' ')}
        >
          Skip
        </button>
      </div>

      {/* Card: only the next dose gets a panel with visible actions; everything else is a quiet text row (Night Shift) */}
      <div
        className={[
          isNext && !settled
            ? 'bg-[#14171b] border border-[#2e333a] rounded-[14px] px-4 py-3.5'
            : 'rounded-[14px] px-3 py-2',
          'transition-all duration-200 relative overflow-hidden',
          cardTranslate,
          actionsDisabled ? 'opacity-70' : '',
        ].join(' ')}
      >
       <div className="flex items-center gap-3.5">
        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className={['truncate', settled ? 'text-sm font-medium text-[#9b978f]' : isNext ? 'text-[15px] font-semibold text-[#e8e6e1]' : 'text-sm font-medium text-[#e8e6e1]'].join(' ')}>
            {item.name}{' '}
            {item.doseAmount ? (
              <span className="font-mono tabular-nums text-xs text-[#9b978f]">{item.doseAmount}{item.doseUnit}</span>
            ) : null}
          </div>
          <div
            className="font-mono tabular-nums text-[10.5px] mt-0.5"
            style={{ color: settled ? '#605d56' : statusColor }}
          >
            {displayStatus === 'taken' && takenAt
              ? (() => {
                  const d = new Date(takenAt);
                  const hh = String(d.getHours()).padStart(2, '0');
                  const mm = String(d.getMinutes()).padStart(2, '0');
                  return `taken ${fmt(`${hh}:${mm}`)}`;
                })()
              : `${(STATUS_LABEL[displayStatus] ?? STATUS_LABEL[dose.status]).toLowerCase()} · ${fmt(dose.scheduledTime)}`}
            {settled && tags.length > 0 ? ` · ${tags.join(' · ').toLowerCase()}` : ''}
          </div>
          {!settled && tags.length > 0 && (
            <div className="flex gap-1.5 mt-1.5 flex-wrap">
              {tags.map(tag => (
                <span key={tag} className="font-mono text-[9.5px] uppercase tracking-wide px-2 py-0.5 rounded-[6px] bg-[rgba(255,255,255,0.06)] text-[#9b978f]">
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Check button — hidden on the next-dose panel, which has visible action buttons instead */}
        {!(isNext && !settled) && (
          <button
            type="button"
            aria-label={displayStatus === 'taken' ? 'Already marked as taken' : 'Mark as taken'}
            onClick={e => {
              e.stopPropagation();
              if (dose.status !== 'taken') onTake();
            }}
            aria-disabled={actionsDisabled}
            className={[
              'rounded-full flex items-center justify-center flex-shrink-0 transition-all duration-200',
              'focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#d9a53f] focus-visible:outline-offset-2',
              settled ? 'w-7 h-7 border text-xs' : 'w-9 h-9 border-[1.5px] text-base',
              actionsDisabled ? 'opacity-50 cursor-not-allowed' : '',
              displayStatus === 'taken'
                ? 'bg-transparent border-[#8fae74] text-[#8fae74] cursor-default'
                : displayStatus === 'skipped'
                ? 'border-[#2e333a] text-[#605d56] hover:border-[#8fae74] hover:text-[#8fae74]'
                : displayStatus === 'overdue'
                ? 'border-[#c96a5a] text-[#c96a5a] hover:bg-[#c96a5a] hover:text-white'
                : 'border-[#2e333a] text-[#605d56] hover:border-[#8fae74] hover:text-[#8fae74]',
            ].join(' ')}
          >
            {displayStatus === 'taken' ? '✓' : ''}
          </button>
        )}
       </div>

        {/* Next-dose panel actions (mockup: Take / Snooze / Skip) — same handlers as circle/swipe */}
        {isNext && !settled && (
          <div className="flex gap-2 mt-3">
            <button
              type="button"
              aria-label={displayStatus === 'taken' ? 'Already marked as taken' : 'Mark as taken'}
              aria-disabled={actionsDisabled}
              onClick={e => {
                e.stopPropagation();
                if (dose.status !== 'taken') onTake();
              }}
              className={[
                'flex-1 rounded-[10px] bg-[#d9a53f] px-4 py-2.5 text-[13px] font-semibold text-[#14120b] transition-colors hover:bg-[#e6b654]',
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#d9a53f] focus-visible:outline-offset-2',
                actionsDisabled ? 'opacity-50 cursor-not-allowed' : '',
              ].join(' ')}
            >
              Take
            </button>
            <button
              type="button"
              aria-disabled={actionsDisabled}
              onClick={() => onSnooze()}
              className={[
                'rounded-[10px] border border-[#2e333a] bg-transparent px-4 py-2.5 text-[13px] font-semibold text-[#9b978f] transition-colors hover:border-[#605d56] hover:text-[#e8e6e1]',
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#d9a53f] focus-visible:outline-offset-2',
                actionsDisabled ? 'opacity-50 cursor-not-allowed' : '',
              ].join(' ')}
            >
              Snooze
            </button>
            <button
              type="button"
              aria-disabled={actionsDisabled}
              onClick={() => onSkip()}
              className={[
                'rounded-[10px] border border-[#2e333a] bg-transparent px-4 py-2.5 text-[13px] font-semibold text-[#9b978f] transition-colors hover:border-[#605d56] hover:text-[#e8e6e1]',
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#d9a53f] focus-visible:outline-offset-2',
                actionsDisabled ? 'opacity-50 cursor-not-allowed' : '',
              ].join(' ')}
            >
              Skip
            </button>
          </div>
        )}
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
          className="px-5 bg-[#4a2620] text-[#e2a89d] font-mono text-[10px] font-bold uppercase tracking-wider flex items-center justify-center rounded-r-[14px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#e8e6e1] focus-visible:outline-offset-[-2px]"
        >
          Delete
        </button>
      </div>
    </div>
  );
}
