'use client';
import { useEffect, useMemo, useRef } from 'react';
import { addDays, format, isSameDay, parseISO } from 'date-fns';

interface Props {
  selectedDate: string;
  onSelectDate: (date: string) => void;
  doseDateSet: Set<string>;
}

export function WeekStrip({ selectedDate, onSelectDate, doseDateSet }: Props) {
  const today = new Date();
  const selected = parseISO(selectedDate);
  const anchorDate = Number.isNaN(selected.getTime()) ? today : selected;
  const days = useMemo(
    () => Array.from({ length: 121 }, (_, i) => addDays(anchorDate, i - 60)),
    [anchorDate],
  );
  const DAY_NAMES = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
  const selectedRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [selectedDate, days]);

  return (
    <div className="flex gap-1.5 overflow-x-auto pb-1 px-5">
      {days.map(d => {
        const dateStr = format(d, 'yyyy-MM-dd');
        const isToday = isSameDay(d, today);
        const isSelected = dateStr === selectedDate;
        const hasDoses = doseDateSet.has(dateStr);

        return (
          <button
            key={dateStr}
            ref={isSelected ? selectedRef : null}
            onClick={() => onSelectDate(dateStr)}
            className={[
              'flex flex-col items-center min-w-[44px] px-1 py-2 rounded-2xl border transition-all duration-200 flex-shrink-0',
              isSelected && isToday  ? 'bg-[#d9a53f] border-transparent text-white' :
              isSelected             ? 'bg-[#191d22] border-[rgba(255,255,255,0.15)] text-[#e8e6e1]' :
              isToday                ? 'border-[#d9a53f] text-[#d9a53f]' :
              'border-transparent text-[#9b978f] hover:text-[#e8e6e1]',
            ].join(' ')}
          >
            <span className="text-[10px] font-bold uppercase tracking-wide">{DAY_NAMES[d.getDay()]}</span>
            <span className="text-[16px] font-bold mt-1">{d.getDate()}</span>
            <div className={`w-1 h-1 rounded-full mt-1.5 ${hasDoses ? (isSelected && isToday ? 'bg-white/60' : 'bg-[#d9a53f]') : 'bg-transparent'}`} />
          </button>
        );
      })}
    </div>
  );
}
