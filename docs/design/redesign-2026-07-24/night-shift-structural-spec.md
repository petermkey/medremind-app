# Night Shift — Structural Gap Spec (phase 2)

> Owner feedback (2026-07-24): the phase-1 rollout only swapped colors/typography; the approved
> Variant B prototype also defines STRUCTURAL elements that must be implemented. This spec lists
> every gap between the live app and `variant-b-night-shift.html`, with the fix plan.
> Constraint unchanged: zero functionality may break; all handlers/state/data flow stay intact.

## Verification status before phase 2 (baseline)

- `npx tsc --noEmit` ✅ · `npm run build` ✅ (41 routes)
- E2E: 7 passed / 0 failed (26 env-gated skips; lifecycle + smoke + archival flows green)
- Independent reviewer A: 8/10 · reviewer B: 9/10 (functionality preservation confirmed twice)
- Reviewer-found design defects folded into this phase: avatar `text-white` on amber gradient
  (page.tsx:251), missing focus rings on MedCard buttons.

## Gap list (mockup → live)

| # | Element | Mockup (approved) | Live now | Fix |
|---|---|---|---|---|
| G1 | Bottom nav | Mono uppercase labels (Sched/Food/Meds/Data/Setup), 18×3px tick bar above, active = amber, NO emoji | Emoji icons + text labels | Restyle `BottomNav.tsx`: drop emoji, mono uppercase 9.5px `tracking-[0.08em]`, tick `w-[18px] h-[3px] rounded-[2px] bg-current opacity-40` (active opacity-100), active `text-[#d9a53f]` |
| G2 | Page header pattern | Mono uppercase micro-label above H1 (`THU 24 JUL` / `FOOD · THU 24 JUL` / `DATA · 30 D WINDOW`), H1 24px semibold −0.02em | Partially applied (Schedule only) | Apply to Food ("Intake"), Progress ("Signals"), Meds, Protocols, Settings |
| G3 | Schedule status strip | One panel, 3 stats with 1px vertical dividers: `5/8 doses taken` · `13:00 next dose` · `14 day streak` (amber); mono 22px | Separate progress-bar panel + Next-dose banner | Merge into single 3-stat strip; derive streak/next-dose from existing state only |
| G4 | Week strip | Plain mono day numbers, selected = amber + 2px bottom border, no boxes | Bordered rounded boxes per day | Restyle `WeekStrip.tsx` (keep onSelectDate, keys, scroll logic) |
| G5 | Timeline rows | Taken/skipped/future doses = plain text rows (name + mono dose inline, faint mono sub-line `taken 08:12 · with food`); ONLY next dose gets a bordered panel with Take/Snooze/Skip | Every dose is a full MedCard with emoji tile + circle checkbox | Restyle MedCard with a `variant` prop (`row` vs `panel`) or conditional classes driven by existing `dose.status`/`isNextDose`; ALL handlers (take/skip/snooze/delete incl. swipe) stay wired on both variants |
| G6 | Emoji icons | None anywhere in app UI | Emoji in nav, MedCard tile, Meds tabs (💊/📖), empty states, `∞ Ongoing`/`📅 Fixed`, greeting ☀️, alarm ⏰ | Remove decorative emoji app-wide. Exceptions: user-chosen protocol item icons remain in protocol EDITOR (data, not chrome); brand pill logo on landing/auth kept |
| G7 | Food page | "Intake": one kcal gauge panel (mono 26px total + `target N kcal`, 5px amber gradient bar, 3-col mono macro row protein/fiber/water), quiet +250/+500 + amber `Log a meal` (flex 1/1/2), Meals list = panel rows with amber mono timestamp + name + faint mono `427 kcal · P14 F16 C58`, eating-window strip at bottom | 5 big macro cards grid, colored water buttons, green Analyze, busier layout | Restructure presentation: merge macro cards into gauge panel (kcal primary; protein/fiber/water in 3-col row; fat/carbs stay as a secondary row — app tracks more than mockup), water buttons → btn-quiet style, entry cards → mockup meal-row format. Photo capture/targets/draft flows keep current logic, restyled chrome only |
| G8 | Progress page | "Signals": adherence panel (mono % + 7-day bar chart amber/amber-dim + mono weekday letters), `Last night · Oura` dense mono table (label left muted / value right semibold, ±delta in ok/danger), pattern card with 2px amber left border + mono `PATTERN · R −0.42 · N 47` label + disclaimer | Own layout, already mono-polished | Restyle top adherence card to mockup bar-chart panel (data from existing weekly data); Oura tab NightCard-style rows → dense mono table format; correlation cards → amber left-border pattern format |
| G9 | Buttons | `btn-quiet`: transparent, 1px `#2e333a` border, muted text, hover border `#605d56`; `btn-primary`: amber, dark ink, hover `#e6b654`; radius 10px | Mostly solid `#23272d` fills | Align secondary/quiet buttons to bordered-transparent style on Schedule/Food (Snooze/Skip/water/Gallery) |
| G10 | Avatar contrast | — | `text-white` on amber gradient (page.tsx:251), fails AA | `text-[#14120b]` |
| G11 | MedCard focus rings | Focus visible everywhere | 4 interactive elements missing rings | Add same `focus-visible` treatment |

## Execution plan

1. **Wave S (shared, sequential, me):** BottomNav (G1) → WeekStrip (G4) → MedCard (G5/G6/G11) → commit per file. `tsc` after each.
2. **Wave P (parallel agents, non-overlapping files):**
   - Schedule `src/app/app/page.tsx`: G2/G3/G5-integration/G6/G9/G10
   - Food `src/app/app/food/page.tsx`: G2/G6/G7/G9
   - Progress `src/app/app/progress/page.tsx` + `src/components/app/oura/NightCard.tsx`: G2/G8
   - Meds+Protocols (`meds/page.tsx`, `protocols/*.tsx`): G2/G6
3. **Verify:** `tsc` + `build` + E2E rerun + browser screenshots of every page.
4. **Re-review:** two independent agents, both ≥8/10, per the standing owner requirement.

## Hard rules (unchanged from phase 1)

- No handler/state/data-flow/conditional-logic changes; presentation-layer restructure only.
- The next-dose panel keeps Take/Snooze/Skip fully functional; plain rows keep their tap/swipe
  actions (invisible chrome ≠ removed functionality).
- Google Sign-In untouched. E2E selectors are role/text-based — keep visible text of actionable
  buttons (`Take`, `Analyze`, `Log a meal` replaces nothing E2E asserts on; check specs before
  renaming any button copy).
