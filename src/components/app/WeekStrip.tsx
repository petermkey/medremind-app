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
              'flex flex-col items-center min-w-[44px] px-1 pt-2 pb-1 border-b-2 transition-all duration-200 flex-shrink-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#d9a53f] focus-visible:outline-offset-2',
              isSelected             ? 'border-[#d9a53f] text-[#d9a53f]' :
              isToday                ? 'border-transparent text-[#e8e6e1]' :
              'border-transparent text-[#605d56] hover:text-[#9b978f]',
            ].join(' ')}
          >
            <span className="font-mono text-[9px] uppercase tracking-[0.08em]">{DAY_NAMES[d.getDay()]}</span>
            <span className={`font-mono tabular-nums text-[14px] mt-1 ${isSelected ? 'font-semibold' : 'font-medium'}`}>{d.getDate()}</span>
            <div className={`w-1 h-1 rounded-full mt-1 mb-0.5 ${hasDoses ? 'bg-[#d9a53f]' : 'bg-transparent'}`} />
          </button>
        );
      })}
    </div>
  );
}
