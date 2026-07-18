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
  'Это не медицинская рекомендация. Stack Guard сравнивает ваш стек со справочными правилами (NIH ODS и др.) и только подсказывает — расписание он никогда не меняет. Перед изменением схемы приёма проконсультируйтесь с врачом.';

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
    <div data-testid="stack-guard-card" className="bg-[#161B22] border border-[rgba(255,255,255,0.08)] rounded-2xl p-4 mb-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="text-sm font-bold text-[#F0F6FC]">🛡️ Stack Guard</div>
        <div className="flex gap-1.5">
          {cautions > 0 && (
            <span className="text-[10px] font-semibold px-2 py-1 rounded-full bg-[rgba(251,191,36,0.12)] text-[#FBB924]">
              ⚠️ {cautions}
            </span>
          )}
          {infos > 0 && (
            <span className="text-[10px] font-semibold px-2 py-1 rounded-full bg-[rgba(59,130,246,0.12)] text-[#3B82F6]">
              ℹ️ {infos}
            </span>
          )}
        </div>
      </div>

      {report.pendingFactsUsed && (
        <div className="text-[10px] font-semibold text-[#FBB924] mb-2">
          Часть данных о составах ещё не подтверждена — выводы могут уточниться.
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
              <span className="text-sm">{finding.severity === 'caution' ? '⚠️' : 'ℹ️'}</span>
              <span className="flex-1 text-xs font-semibold text-[#F0F6FC]">{finding.title}</span>
              <span className="text-[#8B949E] text-xs">{open ? '▴' : '▾'}</span>
            </button>
            {open && (
              <div className="mt-2 pl-6 flex flex-col gap-1.5">
                <div className="text-xs text-[#8B949E] leading-relaxed">{finding.explanation}</div>
                <div className="text-xs text-[#F0F6FC] leading-relaxed">💡 {finding.suggestion}</div>
                <div className="text-[10px] text-[#8B949E]">
                  Затронуто: {finding.itemsInvolved.map((item) => item.name).join(' · ')}
                </div>
                <div className="text-[10px] text-[#8B949E] break-words">Источник: {finding.source}</div>
              </div>
            )}
          </div>
        );
      })}

      <p className="mt-3 text-[10px] text-[#8B949E] leading-relaxed border-t border-[rgba(255,255,255,0.05)] pt-2.5">
        {DISCLAIMER}
      </p>
    </div>
  );
}
