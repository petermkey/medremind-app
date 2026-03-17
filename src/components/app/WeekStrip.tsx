'use client';
import { addDays, format, isSameDay, parseISO } from 'date-fns';

interface Props {
  selectedDate: string;
  onSelectDate: (date: string) => void;
  doseDateSet: Set<string>;
}

export function WeekStrip({ selectedDate, onSelectDate, doseDateSet }: Props) {
  const today = new Date();
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i - 3));
  const DAY_NAMES = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

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
            onClick={() => onSelectDate(dateStr)}
            className={[
              'flex flex-col items-center min-w-[44px] px-1 py-2 rounded-2xl border transition-all duration-200 flex-shrink-0',
              isSelected && isToday  ? 'bg-[#3B82F6] border-transparent text-white' :
              isSelected             ? 'bg-[#1C2333] border-[rgba(255,255,255,0.15)] text-[#F0F6FC]' :
              isToday                ? 'border-[#3B82F6] text-[#3B82F6]' :
              'border-transparent text-[#8B949E] hover:text-[#F0F6FC]',
            ].join(' ')}
          >
            <span className="text-[10px] font-bold uppercase tracking-wide">{DAY_NAMES[d.getDay()]}</span>
            <span className="text-[16px] font-bold mt-1">{d.getDate()}</span>
            <div className={`w-1 h-1 rounded-full mt-1.5 ${hasDoses ? (isSelected && isToday ? 'bg-white/60' : 'bg-[#3B82F6]') : 'bg-transparent'}`} />
          </button>
        );
      })}
    </div>
  );
}
