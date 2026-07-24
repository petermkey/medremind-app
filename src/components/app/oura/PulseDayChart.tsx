'use client';

import { useMemo, useState } from 'react';

export type PulsePoint = { ts: string; bpm: number };
export type PulseTagKind = 'caffeine' | 'alcohol' | 'sauna' | 'other';
export type PulseTag = { ts: string; kind: PulseTagKind; tagType: string | null; comment: string | null };
export type PulseDose = { ts: string; label: string };

const TAG_COLORS: Record<PulseTagKind, string> = {
  caffeine: 'var(--yellow)',
  alcohol: 'var(--purple)',
  sauna: 'var(--chart-warm)',
  other: 'var(--muted)',
};

const TAG_LABELS: Record<PulseTagKind, string> = {
  caffeine: 'Caffeine',
  alcohol: 'Alcohol',
  sauna: 'Sauna',
  other: 'Tag',
};

const DOSE_COLOR = 'var(--blue)';

type Marker = { ts: string; color: string; label: string };

function timeLabel(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

export function PulseDayChart({
  points,
  tags,
  doses,
  startIso,
  endIso,
}: {
  points: PulsePoint[];
  tags: PulseTag[];
  doses: PulseDose[];
  startIso: string;
  endIso: string;
}) {
  const [tooltip, setTooltip] = useState<string | null>(null);

  const startMs = Date.parse(startIso);
  const endMs = Date.parse(endIso);
  const spanMs = Math.max(1, endMs - startMs);
  const width = 320;
  const height = 150;
  const padX = 10;
  const padTop = 14;
  const plotBottom = 112;
  const markerY = 132;

  const bpmValues = points.map(point => point.bpm);
  const domainMin = bpmValues.length ? Math.floor((Math.min(...bpmValues) - 5) / 10) * 10 : 40;
  const domainMax = bpmValues.length ? Math.ceil((Math.max(...bpmValues) + 5) / 10) * 10 : 120;
  const domainSpan = domainMax - domainMin || 1;

  const toX = (ms: number) => padX + ((ms - startMs) / spanMs) * (width - padX * 2);
  const toY = (bpm: number) => padTop + (1 - (bpm - domainMin) / domainSpan) * (plotBottom - padTop);

  const markers = useMemo<Marker[]>(() => {
    const tagMarkers = tags.map(tag => ({
      ts: tag.ts,
      color: TAG_COLORS[tag.kind],
      label: `${timeLabel(tag.ts)} · ${TAG_LABELS[tag.kind]}${tag.comment ? ` - ${tag.comment}` : ''}`,
    }));
    const doseMarkers = doses.map(dose => ({
      ts: dose.ts,
      color: DOSE_COLOR,
      label: `${timeLabel(dose.ts)} · ${dose.label} · dose taken`,
    }));
    return [...tagMarkers, ...doseMarkers]
      .filter((marker) => {
        const ms = Date.parse(marker.ts);
        return Number.isFinite(ms) && ms >= startMs && ms <= endMs;
      })
      .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  }, [tags, doses, startMs, endMs]);

  if (points.length === 0 && markers.length === 0) {
    return <p className="text-sm text-[var(--muted)]">No heart-rate samples for this day yet.</p>;
  }

  const linePath = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${toX(Date.parse(point.ts)).toFixed(1)},${toY(point.bpm).toFixed(1)}`)
    .join(' ');

  return (
    <div>
      <div className="mb-1 text-[10px] font-semibold text-[var(--muted)]">
        {tooltip ?? (bpmValues.length
          ? `${Math.min(...bpmValues)}-${Math.max(...bpmValues)} bpm · tap a marker for details`
          : 'No samples · tap a marker for details')}
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-40 w-full touch-none"
        role="img"
        aria-label="Intraday heart rate"
        data-testid="pulse-day-chart"
        onClick={(event) => {
          if (event.target === event.currentTarget) setTooltip(null);
        }}
      >
        <line x1={padX} x2={width - padX} y1={plotBottom} y2={plotBottom} stroke="rgba(var(--overlay-rgb),0.15)" />
        {points.length > 0 && (
          <path d={linePath} fill="none" stroke="var(--red-border-soft)" strokeWidth="1.5" strokeLinejoin="round" pointerEvents="none" />
        )}
        {markers.map((marker, index) => (
          <circle
            key={`${marker.ts}-${index}`}
            cx={toX(Date.parse(marker.ts))}
            cy={markerY}
            r="6"
            fill={marker.color}
            data-testid="pulse-marker"
            onClick={() => setTooltip(marker.label)}
          />
        ))}
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-[var(--muted)]">
        <span>{timeLabel(startIso)}</span>
        <span>{timeLabel(endIso)}</span>
      </div>
    </div>
  );
}
