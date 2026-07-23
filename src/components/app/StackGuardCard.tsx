'use client';
import { useEffect, useState } from 'react';

type Finding = {
  ruleId: string;
  severity: 'info' | 'caution';
  itemsInvolved: { protocolItemId: string; name: string }[];
  title: string;
  explanation: string;
  suggestion: string;
  source: string;
};

type Report = {
  findings: Finding[];
  itemCount: number;
  factsMatchedCount: number;
  pendingFactsUsed: boolean;
  rulesetVersion: number;
};

const DISCLAIMER =
  'This is not medical advice. Stack Guard compares your stack against reference rules (NIH ODS and others) and only flags possible issues; it never changes your schedule. Consult a clinician before changing your regimen.';

export function StackGuardCard() {
  const [report, setReport] = useState<Report | null>(null);
  const [failed, setFailed] = useState(false);
  const [openRuleId, setOpenRuleId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/insights/stack-guard')
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((json: Report) => { if (!cancelled) setReport(json); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, []);

  if (failed || !report || report.findings.length === 0) return null;

  const cautions = report.findings.filter((finding) => finding.severity === 'caution').length;
  const infos = report.findings.length - cautions;

  return (
    <div data-testid="stack-guard-card" className="bg-[#14171b] border border-[rgba(255,255,255,0.08)] rounded-2xl p-4 mb-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="text-sm font-bold text-[#e8e6e1]">Stack Guard</div>
        <div className="flex gap-1.5">
          {cautions > 0 && (
            <span className="text-[10px] font-semibold px-2 py-1 rounded-full bg-[rgba(207,129,72,0.12)] text-[#cf8148]">
              {cautions}
            </span>
          )}
          {infos > 0 && (
            <span className="text-[10px] font-semibold px-2 py-1 rounded-full bg-[rgba(217,165,63,0.12)] text-[#d9a53f]">
              {infos}
            </span>
          )}
        </div>
      </div>

      {report.pendingFactsUsed && (
        <div className="text-[10px] font-semibold text-[#cf8148] mb-2">
          Some composition data is still unconfirmed, so findings may change.
        </div>
      )}

      {report.findings.map((finding) => {
        const open = openRuleId === finding.ruleId;
        return (
          <div key={finding.ruleId} className="border-t border-[rgba(255,255,255,0.05)] py-2.5">
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setOpenRuleId(open ? null : finding.ruleId)}
              className="w-full flex items-center gap-2 text-left"
            >
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${finding.severity === 'caution' ? 'bg-[#cf8148]' : 'bg-[#9b978f]'}`} />
              <span className="flex-1 text-xs font-semibold text-[#e8e6e1]">{finding.title}</span>
              <span className="text-[#9b978f] text-xs">{open ? '▴' : '▾'}</span>
            </button>
            {open && (
              <div className="mt-2 pl-6 flex flex-col gap-1.5">
                <div className="text-xs text-[#9b978f] leading-relaxed">{finding.explanation}</div>
                <div className="text-xs text-[#e8e6e1] leading-relaxed">{finding.suggestion}</div>
                <div className="text-[10px] text-[#9b978f]">
                  Affected: {finding.itemsInvolved.map((item) => item.name).join(' · ')}
                </div>
                <div className="text-[10px] text-[#9b978f] break-words">Source: {finding.source}</div>
              </div>
            )}
          </div>
        );
      })}

      <p className="mt-3 text-[10px] text-[#9b978f] leading-relaxed border-t border-[rgba(255,255,255,0.05)] pt-2.5">
        {DISCLAIMER}
      </p>
    </div>
  );
}
