# Night Shift (Variant B) — Implementation Brief

> Handoff for a fresh session. Owner picked **Variant B "Night Shift"** from
> `docs/design/redesign-2026-07-24/variant-b-night-shift.html` (branch
> `codex/taste-redesign-variants`, pushed). Apply it to the LIVE app code on branch
> **`codex/redesign-night-shift-full`** (already created off fresh `origin/main`, zero
> commits yet). Methodology source: taste-skill / redesign-skill
> (https://github.com/Leonxlnx/taste-skill).

## Hard constraints (owner's words, non-negotiable)

1. **No functionality may break anywhere.** Buttons, forms, sheets, sync, PWA, push —
   everything works exactly as before. If aesthetics conflict with function, function wins.
2. Every page, once redesigned, is reviewed by **TWO independent agents** (neither sees the
   other's output). Each scores the page 0–10 on functionality-preservation + design-application
   quality. **Both must score ≥8**; otherwise rework and re-review until they do.
3. Feature branch only; never push `main`; PR at the end; merge is owner-only (triggers prod
   deploy). Standard gates before PR: `npx tsc --noEmit` && `npm run build` (+ `npm run
   test:unit` if touched files overlap).
4. Work self-paced via `/loop` until all pages are done, without unnecessary questions.

## Key technical fact (already verified)

Components do **NOT** use the Tailwind theme tokens defined in `tailwind.config.ts` — every
component hardcodes literal hex/rgba inside arbitrary-value classes (`text-[#3B82F6]`,
`bg-[rgba(59,130,246,0.15)]`). So the rollout = (a) update tokens in `globals.css` +
`tailwind.config.ts`, then (b) a careful scripted 1:1 string replacement of hex/rgba literals
across `src/**/*.{ts,tsx,css}`. Pure color-string substitution inside className/style strings
does not touch JSX structure, logic, handlers, or data flow — that is what keeps constraint #1
satisfiable. Verify with `git diff --word-diff` spot checks + tsc + build.

Frequency audit (top): `#8B949E`×240, `#F0F6FC`×148, `#3B82F6`×95, `#161B22`×47, `#1C2333`×43,
`#0D1117`×40, `#10B981`×38, `#EF4444`×33, `#FBBF24`×28, `#C9D1D9`×19, `#30363D`×19,
`#FCA5A5`×17, `#8B5CF6`×12. rgba decimal triples mirror the same colors (103× `rgba(255,255,255`
— keep white overlays as-is).

## Night Shift palette (source of truth: variant-b mockup `:root`)

```
--ink:#0e1013  --panel:#14171b  --panel-2:#191d22
--text:#e8e6e1 --muted:#9b978f  --faint:#605d56
--line:#23272d --line-strong:#2e333a
--accent:#d9a53f --accent-dim:#a67c2a --accent-soft:rgba(217,165,63,.1)
--ok:#8fae74  --danger:#c96a5a
Fonts: Space Grotesk (400–700) body, JetBrains Mono (400–600) for data/labels,
tabular-nums on all numerals. Dials: VARIANCE 6 / MOTION 5 / DENSITY 5.
```

## Mapping table (old → new)

### Structural (mechanical 1:1)

| Old | New | Role |
|---|---|---|
| `#0D1117` | `#0e1013` | page bg |
| `#111827`, `#0F172A` | `#111419` | bg-alt |
| `#161B22` | `#14171b` | surface / cards |
| `#1C2333` | `#191d22` | surface2 / inputs |
| `#1C2128` | `#16191e` | between-surface |
| `#F0F6FC` | `#e8e6e1` | primary text |
| `#C9D1D9` | `#c4c0b8` | secondary-bright text |
| `#8B949E` | `#9b978f` | muted text |
| `#30363D` | `#23272d` | borders AND solid pill/btn bg (both uses OK) |
| `#3B82F6` | `#d9a53f` | primary accent / CTA / links |
| `#2563EB` | `#a67c2a` | accent pressed/dark |
| `#10B981` | `#8fae74` | success |
| `#34D399` | `#a3bf8a` | success-light |
| `#EF4444` | `#c96a5a` | danger |
| `#F87171`, `#F85149` | `#d98a7c` | danger-light |
| `#FCA5A5` | `#e2a89d` | danger-lighter (delete links) |
| `#7F1D1D` | `#4a2620` | danger dark bg |
| `#FBBF24`, `#FBB924`, `#F59E0B` | `#cf8148` | warning → muted orange (amber is now the ACCENT; taste-skill: status ≠ accent) |
| `#38BDF8` | `#7fa6bf` | info/sky |
| `#740244` | `#4a2438` | dark rose bg |

### rgba() triples (same colors, alpha preserved verbatim)

`59,130,246→217,165,63` · `251,191,36→207,129,72` · `245,158,11→207,129,72` ·
`16,185,129→143,174,116` · `239,68,68→201,106,90` · `248,81,73→201,106,90` ·
`248,113,113→217,138,124` · `139,92,246→162,146,201` · `168,85,247→162,146,201` ·
`236,72,153→201,124,152` · `56,189,248→127,166,191` · `13,17,23→14,16,19` ·
`22,27,34→20,23,27` · **`255,255,255` and `0,0,0` — leave untouched.**

### Semantic category/chart colors (deliberate distinct hues, NOT collapsed into accent)

| Old | New | Where |
|---|---|---|
| `#8B5CF6` purple | `#a292c9` muted lavender | protocol category, Progress RING_COLORS, "Active" stat, protocols badge |
| `#EC4899` pink | `#c97c98` muted rose | ring-chart series |
| `#F97316` orange | `#c96a3a` burnt orange | Oura tags: sauna/warmer/stress (`PulseDayChart.tsx`, `PulseDayCard.tsx`, `TrendChart.tsx`) — keep visually distinct from warning `#cf8148` if they ever share a chart |

### EXCLUDED — never touch

Google Sign-In brand colors `#4285F4 #34A853 #FBBC05 #EA4335` — only in
`src/app/(auth)/login/page.tsx` and `src/app/(auth)/register/page.tsx`. Any replacement
script must skip these 4 values explicitly (they don't collide with any mapped value, but
guard anyway).

## Execution order

1. **Foundation commit:** `src/app/globals.css` — swap `@import` to Space Grotesk + JetBrains
   Mono, rewrite `:root` vars to the Night Shift set (keep var NAMES so existing `var(--…)`
   refs keep working; just change values, and note `--blue` etc. names become misnomers —
   acceptable, do not rename in this pass). `tailwind.config.ts` — same value swap. Add
   `font-variant-numeric: tabular-nums` utility or apply via mono font class.
2. **Bulk remap commit:** scripted replace (python over `src/**/*.{ts,tsx,css}`, longest-match
   first, case-insensitive hex match preserving original case-format, Google colors excluded).
   Then `npx tsc --noEmit` && `npm run build`.
3. **Per-page structural polish** (separate commit per page, in this order): Schedule `/app` →
   Food `/app/food` → Meds `/app/meds` → Protocols list/new/[id] → Progress (both tabs) →
   Settings → onboarding/login/register. Apply Variant B language where it doesn't disturb
   behavior: mono uppercase `.label` micro-headers, hairline borders + panels instead of
   heavy card-on-card, timeline rail on Schedule, tabular-nums, `:focus-visible` rings,
   btn-primary amber with dark text `#14120b`, nav ticks. Skip anything that would require
   restructuring interactive JSX.
4. **After each page's polish commit:** dispatch the two independent reviewers (Agent tool,
   e.g. `code-reviewer` type + general-purpose, run concurrently, neither sees the other).
   Prompt each with: the page file(s), the diff vs `origin/main`, this brief's constraints,
   and ask for a 0–10 score (functionality preservation weighted first) + defect list.
   Both ≥8 → next page. Any <8 → fix defects, re-run both.
5. PR from `codex/redesign-night-shift-full` when all pages pass. Do not merge.

## Verification landmines

- `AddDoseSheet`, `WeekStrip`, `BottomNav`, `SyncStatusPill`, `MedCard`, Oura components,
  UI primitives (`Button`/`Input`/`Select`/`Toast`) are shared — they get remapped in step 2
  and re-checked implicitly by every page review.
- Progress page has canvas/SVG chart code with color constants in JS (not className) —
  `RING_COLORS` array, `seedColor` ternaries. The remap script must cover plain string
  literals in `.ts/.tsx`, not just classNames (it does, if it's a plain text replace).
- Food page uses `#30363D` as a disabled-button bg (`cursor-not-allowed`) — after remap to
  `#23272d`, verify disabled state is still visually distinct from enabled.
- E2E (`npm run test:e2e`) selectors are role/text-based, not color-based — colors won't break
  them, but run the suite once after step 2 if the environment allows.
