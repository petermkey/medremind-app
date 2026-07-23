'use client';
// Dismissible in-app copy of today's morning briefing (W3-B). It derives text
// on the fly from /api/health/oura/summary using the same pure buildBriefing()
// the cron push uses, so nothing is stored.
import { useEffect, useState } from 'react';

import {
  baselineAverage,
  buildBriefing,
  type Briefing,
  type BriefingSnapshot,
} from '@/lib/briefing/briefing';

type SummaryDay = {
  localDate: string;
  readinessScore: number | null;
  sleepScore: number | null;
  sleepAvgHrv: number | null;
  temperatureDeviation: number | null;
};

const DISMISS_KEY = 'medremind-briefing-dismissed-v1';

const SEVERITY_STYLE: Record<Briefing['severity'], { border: string; bg: string; dot: string }> = {
  good: { border: 'rgba(143,174,116,0.35)', bg: 'rgba(143,174,116,0.08)', dot: '#8fae74' },
  info: { border: 'rgba(217,165,63,0.3)', bg: 'rgba(217,165,63,0.08)', dot: '#d9a53f' },
  caution: { border: 'rgba(207,129,72,0.35)', bg: 'rgba(207,129,72,0.08)', dot: '#cf8148' },
  warning: { border: 'rgba(201,106,90,0.35)', bg: 'rgba(201,106,90,0.08)', dot: '#c96a5a' },
};

export function MorningBriefingCard({ todayStr, doseCount }: { todayStr: string; doseCount: number }) {
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    setDismissed(localStorage.getItem(DISMISS_KEY) === todayStr);
  }, [todayStr]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/health/oura/summary?days=31')
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { connected?: boolean; days?: SummaryDay[] } | null) => {
        if (cancelled || !payload?.connected || !Array.isArray(payload.days)) return;
        const todayRow = payload.days.find((day) => day.localDate === todayStr) ?? null;
        if (!todayRow) return;
        const baselineDays = payload.days.filter((day) => day.localDate !== todayStr);
        const snapshot: BriefingSnapshot = {
          readinessScore: todayRow.readinessScore,
          sleepScore: todayRow.sleepScore,
          sleepAvgHrv: todayRow.sleepAvgHrv,
          temperatureDeviation: todayRow.temperatureDeviation,
        };
        setBriefing(
          buildBriefing(
            snapshot,
            {
              readinessAvg30: baselineAverage(baselineDays.map((day) => day.readinessScore)),
              hrvAvg30: baselineAverage(baselineDays.map((day) => day.sleepAvgHrv)),
            },
            doseCount,
          ),
        );
      })
      .catch(() => {
        // Summary unavailable: omit the card.
      });
    return () => {
      cancelled = true;
    };
  }, [todayStr, doseCount]);

  if (dismissed || !briefing) return null;
  const style = SEVERITY_STYLE[briefing.severity];

  return (
    <div
      data-testid="morning-briefing-card"
      className="rounded-2xl border p-4 mb-5"
      style={{ borderColor: style.border, background: style.bg }}
    >
      <div className="flex items-start gap-3">
        <span className="mt-1.5 w-2 h-2 rounded-full flex-shrink-0" style={{ background: style.dot }} />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold text-[#e8e6e1]">{briefing.title}</div>
          <div className="text-xs text-[#9b978f] mt-1 leading-relaxed">{briefing.body}</div>
        </div>
        <button
          type="button"
          aria-label="Dismiss briefing"
          onClick={() => {
            localStorage.setItem(DISMISS_KEY, todayStr);
            setDismissed(true);
          }}
          className="text-[#9b978f] hover:text-[#e8e6e1] text-lg leading-none px-1"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
