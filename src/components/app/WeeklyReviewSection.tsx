'use client';
// «Недельный разбор» (W4-B): latest stored review + archive, rendered
// section-by-section from the schema-validated payload. Renders nothing when
// the user has no reviews (feature is opt-in via Settings).
import { useEffect, useState } from 'react';

import type { WeeklyReviewPayload } from '@/lib/weeklyReview/schema';

type StoredReview = {
  id: string;
  weekStart: string;
  payload: WeeklyReviewPayload;
  model: string;
  createdAt: string;
};

function formatWeek(weekStart: string): string {
  const start = new Date(`${weekStart}T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  const format = (date: Date) =>
    `${String(date.getUTCDate()).padStart(2, '0')}.${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  return `${format(start)} – ${format(end)}`;
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-3">
      <div className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-widest mb-1.5">{title}</div>
      {children}
    </div>
  );
}

export function WeeklyReviewSection() {
  const [reviews, setReviews] = useState<StoredReview[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/insights/weekly-review')
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { reviews?: StoredReview[] } | null) => {
        if (cancelled || !data?.reviews?.length) return;
        setReviews(data.reviews);
        setSelectedId(data.reviews[0].id);
      })
      .catch(() => {
        // endpoint unavailable — section simply doesn't render
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selected = reviews.find((review) => review.id === selectedId) ?? reviews[0];
  if (!selected) return null;
  const payload = selected.payload;

  return (
    <div
      data-testid="weekly-review-section"
      className="rounded-2xl border border-[rgba(var(--purple-rgb),0.3)] bg-[rgba(var(--purple-rgb),0.06)] p-4 mt-3 mb-3"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-bold text-[var(--text)]">Weekly review</div>
        <div className="text-[11px] text-[var(--muted)]">{formatWeek(selected.weekStart)}</div>
      </div>

      <Block title="Week highlights">
        <ul className="flex flex-col gap-1">
          {payload.highlights.map((highlight) => (
            <li key={highlight} className="text-xs text-[var(--text)] leading-relaxed">• {highlight}</li>
          ))}
        </ul>
      </Block>

      <Block title="Nutrition">
        {payload.eatingPatterns.map((pattern) => (
          <div key={pattern.title} className="mb-1.5">
            <span className="text-xs font-semibold text-[var(--text)]">{pattern.title}: </span>
            <span className="text-xs text-[var(--muted)]">{pattern.detail}</span>
          </div>
        ))}
      </Block>

      <Block title="Stack adherence">
        <p className="text-xs text-[var(--muted)] leading-relaxed">{payload.stackAdherence.summary}</p>
      </Block>

      {payload.ouraLinkage.length > 0 && (
        <Block title="Sleep & recovery">
          <ul className="flex flex-col gap-1">
            {payload.ouraLinkage.map((linkage) => (
              <li key={linkage} className="text-xs text-[var(--muted)] leading-relaxed">• {linkage}</li>
            ))}
          </ul>
        </Block>
      )}

      <Block title="For next week">
        {payload.actions.map((action) => (
          <div key={action.title} className="mb-1.5">
            <span className="text-xs font-semibold text-[var(--green)]">{action.title}: </span>
            <span className="text-xs text-[var(--muted)]">{action.detail}</span>
          </div>
        ))}
      </Block>

      {reviews.length > 1 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {reviews.map((review) => (
            <button
              key={review.id}
              type="button"
              onClick={() => setSelectedId(review.id)}
              className={[
                'rounded-lg px-2 py-1 text-[11px] font-semibold transition-colors',
                review.id === selected.id
                  ? 'bg-[var(--purple)] text-white'
                  : 'bg-[var(--surface2)] text-[var(--muted)] hover:text-[var(--text)]',
              ].join(' ')}
            >
              {formatWeek(review.weekStart)}
            </button>
          ))}
        </div>
      )}

      <p className="mt-3 text-[10px] text-[var(--muted)] leading-relaxed">
        This is not medical advice. Do not change your medications or supplements without consulting your healthcare provider.
      </p>
    </div>
  );
}
