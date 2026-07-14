'use client';

import { useMemo, useState } from 'react';

import { normalizeBars } from '@/lib/health/ouraStats';

type Tooltip = {
  index: number;
  label: string;
  value: string;
};

function fmt(value: number | null, suffix = ''): string {
  if (value === null) return 'No data';
  const rounded = Math.abs(value) >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded}${suffix}`;
}

function medianLine(values: Array<number | null>, fixedDomain?: [number, number]): number | null {
  const finite = values.filter((value): value is number => value !== null && Number.isFinite(value));
  if (finite.length < 7) return null;
  const sorted = [...finite].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  const domain = fixedDomain ?? [Math.min(...finite), Math.max(...finite)] as [number, number];
  const span = domain[1] - domain[0] || 1;
  return 1 - Math.max(0, Math.min(1, (median - domain[0]) / span));
}

export function TrendChart({
  title,
  dates,
  values,
  secondaryValues,
  lowWearMask,
  mode = 'bars',
  fixedDomain,
  valueSuffix = '',
}: {
  title: string;
  dates: string[];
  values: Array<number | null>;
  secondaryValues?: Array<number | null>;
  lowWearMask?: boolean[];
  mode?: 'bars' | 'diverging' | 'paired';
  fixedDomain?: [number, number];
  valueSuffix?: string;
}) {
  const [tooltip, setTooltip] = useState<Tooltip | null>(null);
  const bars = useMemo(() => normalizeBars({ values, lowWearMask, fixedDomain }), [values, lowWearMask, fixedDomain]);
  const secondaryBars = useMemo(
    () => secondaryValues ? normalizeBars({ values: secondaryValues, lowWearMask, fixedDomain }) : [],
    [secondaryValues, lowWearMask, fixedDomain],
  );
  const lineY = medianLine(values, fixedDomain);
  const hasData = values.some(value => value !== null) || (secondaryValues?.some(value => value !== null) ?? false);
  if (!hasData) return null;

  const width = 320;
  const height = 116;
  const padX = 10;
  const padY = 12;
  const plotWidth = width - padX * 2;
  const plotHeight = height - padY * 2;
  const slot = plotWidth / Math.max(values.length, 1);
  const barWidth = Math.max(2, Math.min(8, slot * 0.62));
  const zeroY = padY + plotHeight / 2;

  return (
    <div className="rounded-lg border border-[rgba(255,255,255,0.06)] bg-[#0D1117] p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="text-xs font-bold text-[#F0F6FC]">{title}</div>
        {tooltip && <div className="text-[10px] text-[#8B949E]">{tooltip.label} · {tooltip.value}</div>}
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-28 w-full"
        role="img"
        aria-label={`${title} trend`}
        onClick={(event) => {
          if (event.target === event.currentTarget) setTooltip(null);
        }}
      >
        <rect x="0" y="0" width={width} height={height} rx="8" fill="transparent" />
        {lineY !== null && mode !== 'diverging' && (
          <line
            x1={padX}
            x2={width - padX}
            y1={padY + lineY * plotHeight}
            y2={padY + lineY * plotHeight}
            stroke="rgba(255,255,255,0.35)"
            strokeDasharray="4 4"
          />
        )}
        {mode === 'diverging' && (
          <line x1={padX} x2={width - padX} y1={zeroY} y2={zeroY} stroke="rgba(255,255,255,0.28)" strokeDasharray="4 4" />
        )}
        {bars.map((bar, index) => {
          if (bar.value === null) return null;
          const x = padX + index * slot + (slot - barWidth) / 2;
          const isLatest = index === bars.length - 1;
          let y = padY + bar.y * plotHeight;
          let h = Math.max(1, bar.height * plotHeight);
          let fill = isLatest ? '#60A5FA' : '#3B82F6';

          if (mode === 'diverging') {
            const magnitude = Math.min(1, Math.abs(bar.value) / 1);
            h = Math.max(1, magnitude * (plotHeight / 2));
            y = bar.value >= 0 ? zeroY - h : zeroY;
            fill = bar.value >= 0 ? '#F97316' : '#38BDF8';
          }

          if (mode === 'paired') {
            const pairWidth = Math.max(2, barWidth / 2 - 1);
            const second = secondaryBars[index];
            return (
              <g key={`${dates[index]}-${index}`}>
                <rect
                  x={x}
                  y={y}
                  width={pairWidth}
                  height={h}
                  rx="1.5"
                  fill="#F97316"
                  opacity={bar.opacity}
                  onClick={() => setTooltip({ index, label: dates[index] ?? '', value: `${fmt(bar.value, valueSuffix)} stress` })}
                />
                {second?.value !== null && second?.value !== undefined && (
                  <rect
                    x={x + pairWidth + 2}
                    y={padY + second.y * plotHeight}
                    width={pairWidth}
                    height={Math.max(1, second.height * plotHeight)}
                    rx="1.5"
                    fill="#10B981"
                    opacity={second.opacity}
                    onClick={() => setTooltip({ index, label: dates[index] ?? '', value: `${fmt(second.value, valueSuffix)} recovery` })}
                  />
                )}
              </g>
            );
          }

          return (
            <rect
              key={`${dates[index]}-${index}`}
              x={x}
              y={y}
              width={barWidth}
              height={h}
              rx="2"
              fill={fill}
              opacity={bar.opacity}
              onClick={() => setTooltip({ index, label: dates[index] ?? '', value: fmt(bar.value, valueSuffix) })}
            />
          );
        })}
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-[#8B949E]">
        <span>{dates[0] ?? ''}</span>
        <span>{dates[dates.length - 1] ?? ''}</span>
      </div>
    </div>
  );
}
