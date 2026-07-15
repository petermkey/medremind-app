# MedRemind — Mobile Design Handoff (2026-07-15)

> Purpose: reference for manual design correction/polish of every page of the app, mobile-first (375×812 viewport, iOS Safari PWA target).
> Method: every route below was opened live in an authenticated session at 375×812 and inspected via DOM queries + visual screenshots (not synthetic/mock data, except where noted). No screenshot image files are embedded here — this doc describes structure, tokens, and issues precisely enough to act on; re-open any route live to see it pixel-for-pixel.

---

## 1. Design tokens (as currently implemented)

| Token | Value | Usage |
|---|---|---|
| App background | `#0D1117` | page background, "inset" panels inside cards |
| Card background | `#161B22` | primary card/section surface |
| Card border | `rgba(255,255,255,0.06–0.08)` | 1px hairline on cards |
| Accent blue | `#3B82F6` (hover/active `#2563EB`, light variant `#60A5FA`) | primary buttons, links, active nav, latest-bar highlight |
| Neutral button | `#30363D` (hover `#363B42`) | secondary buttons |
| Success green | `#10B981` / `#238636` | positive deltas, "ACTIVE" state, confirm actions |
| Warning amber | `#FBBF24` | fallback-data banners, 50–79% adherence |
| Danger red | `#F87171` (badges) / `#EF4444`-ish (destructive buttons) | negative deltas, Delete actions, <50% adherence |
| Text primary | `#F0F6FC` | headings, primary values |
| Text secondary | `#8B949E` | labels, captions, secondary text |
| Radius | `rounded-xl` (12px) / `rounded-2xl` (16px) | cards / sections |
| Section header style | 10–12px bold uppercase, `tracking-widest`, `#8B949E` | e.g. "LAST NIGHT", "TRENDS", "PROFILE" |
| Bottom nav | fixed, 6 items, icon + label, active = blue | Schedule / Food / Meds / Protocols / Progress / Settings |
| Toast | pill, green tint, bottom-left, "✓ Synced" | global sync-status indicator |

These are informally reverse-engineered from Tailwind arbitrary-value classes in the components — there is no central token file (`tailwind.config` uses defaults; colors are hardcoded per-component as `bg-[#161B22]` etc). **Recommendation for design system cleanup**: extract these into a shared token file so a designer can retheme in one place instead of hunting through components.

---

## 2. Page-by-page notes

### 2.1 `/` — Landing page
- Centered logo mark (rounded-2xl app icon), app name, one-line pitch, two full-width CTAs ("Get started — it's free" primary blue, "Sign in" secondary outline), disclaimer line below.
- Clean, no issues found. Good reference for empty/marketing-state styling.

### 2.2 `/register`, `/login`
- **Could not capture live**: middleware (`src/proxy.ts`) redirects any authenticated session away from these routes straight to `/app`. To design these, either use a private/incognito session or a logged-out browser profile.

### 2.3 `/onboarding` — 3-step wizard (Profile → First Protocol → Reminders)
- Step indicator: numbered circles + labels, connected by a horizontal rule. Step 2's label ("First Protocol") wraps to two lines while steps 1 and 3 stay on one line — causes slight vertical misalignment of the connector line relative to the circle. **Minor polish item.**
- Step 1 form: Name text input, Age range `<select>`, Timezone (auto-detected, read-only-styled input) with helper text, full-width primary CTA "Continue →".
- **Data inconsistency observed**: onboarding pre-filled Age range as "31–50", but the account's actual saved Settings → Profile value is "51–70". Worth checking whether onboarding re-runs against stale defaults for existing users landing here again, vs. only ever running once at signup.

### 2.4 `/app` — Schedule (home, default bottom-nav tab)
- Captured earlier in session; standard dose-card list grouped by time-of-day, take/skip/snooze actions per card.

### 2.5 `/app/food`
- Header: date label + "Food" title, action row (Capture / Gallery / Set targets buttons + hidden file inputs), then a meal-description text input + analyze button.
- **🔴 Confirmed layout bug (high priority)**: the meal-description input row (`<div className="mt-2 flex gap-2">` in `src/app/app/food/page.tsx`, ~line 730) is nested as a **third child inside** the header's `<div className="mb-4 flex items-center justify-between gap-3">` row, instead of being a sibling below it. Because the parent is a `flex justify-between` row, the 375px-wide title + 3 action buttons already fill the row, so the meal-input becomes the 3rd flex item and gets pushed ~140–190px off the right edge of the viewport — **it is present in the DOM and functional, but invisible and untappable** on mobile. Confirmed via `getBoundingClientRect()`: input renders at `x≈309, width≈190` against a 375px viewport.
  - Likely root cause: a missing `</div>` closing the header row before the `mt-2 flex gap-2` div opens (or an extra one deleted). Needs a source read/diff around `src/app/app/food/page.tsx:690–792` to pinpoint the exact tag, then move the meal-input `<div>` to be a sibling after the header `<div>` closes.
  - Not fixed in this session — flagged for a dedicated fix pass since current scope was documentation only.
- "Capture"/"Gallery" buttons trigger native hidden `<input type="file">` pickers — no visible in-app dialog by design (expected, not a bug).
- "Set targets" opens a separate inline "Edit targets" form (not a modal) — captured, functions correctly.

### 2.6 `/app/meds`
- Search bar, "My Meds" / "Catalogue" segmented toggle (blue active pill), then a scrollable list of medication cards (emoji icon, name, schedule label).
- Bottom-nav area: the "✓ Synced" toast (bottom-left, floating) overlaps the last visible medication card's secondary label and partially covers the "Schedule" nav icon/label. **Minor overlap — the toast has no viewport-aware placement and just floats above the nav bar at a fixed position regardless of what's scrolled underneath it.**

### 2.7 `/app/protocols` — list
- Search bar, 4-way segmented filter ("Current" / "Templates" / "My Protocols" / "All"), then protocol cards: emoji icon, name, status pill (PAUSED amber / ACTIVE green), description, item count, start date, primary action (Resume/Pause) + Edit + Delete icon buttons.
- **🟡 Text truncation bug**: protocol names are clipped with a hard ellipsis at a fixed character count rather than a responsive text wrap or `truncate` class tuned to available width — "Daily Essent…", "Cardiovascu…", "Metabolic R…", "Sleep & Rec…" all cut off well before the card's right edge has anything else in it. There's no visual reason for the truncation (no colliding sibling), so this reads as a bug rather than an intentional space constraint — check the name `<div>`'s width/`max-w` constraint.
- Same floating "Synced" toast overlap issue as Meds page.

### 2.8 `/app/protocols/new`
- 3-step wizard (progress bar at top). Step 1: Protocol name, optional description, Category select, Duration toggle (Ongoing / Fixed), "Next →" CTA. Clean, no issues found.

### 2.9 `/app/protocols/[id]` (edit/detail — e.g. `Daily Essentials`)
- **Note**: there is no separate read-only "detail" view — navigating to `/app/protocols/[id]` with or without `?edit=1` renders the same edit-mode screen. If a read-only detail view was intended to exist separately, it doesn't currently.
- Layout, top to bottom: Back link, title + status pill, description, Resume/Delete actions, "Edit Protocol" form (Name/Description/Category + Save), 3 stat tiles (Items / Duration / Started), "FUTURE PLAN" section (empty-state text when ongoing with no scheduled rows), "HANDLED HISTORY" (recent skipped/snoozed log entries), "ADD ITEM" form (Type/Name/Amount/Unit/Form/Route/With-food/Frequency/Time/Instructions/Colour — a long form, all fields visible without an accordion), "ITEMS" list (existing items with emoji, name+dose, schedule badges, Edit/Delete), and a fixed medical-disclaimer footer note.
- No functional bugs found; this is simply a very long single-scroll page — a design polish candidate would be collapsing "Add item" behind a toggle/accordion since it's rarely used compared to viewing the items list.

### 2.10 `/app/progress` — Correlations tab (default)
- Top summary card ("On track 84%", weekly dose count, delta vs last week), Today's taken/left/skipped mini-stats row, 2×2 stat grid (Adherence 30d / Streak / Active protocols / Taken count), "Health & Medication Patterns" card linking to Settings, medication-pattern-analysis consent card (empty state until enabled), "LAST 7 DAYS" — a 7-day ring/donut strip per protocol color, "MONTHLY PATTERN" — a calendar heatmap (30d/60d/90d toggle, colour-coded ≥80%/50–79%/<50%), "BY PROTOCOL" — horizontal bar list with adherence % per protocol.
- This is a data-dense page; all sections read clearly on mobile once scrolled. No bugs found in Correlations.
- Minor: the top banner's "84%" (this week) and the stat grid's "48% Adherence · last 30d" sit close together with no visual distinction of timeframe beyond small caption text — a designer might want to differentiate these two "adherence" numbers more visually since they're easy to conflate at a glance.

### 2.11 `/app/progress` — Oura tab
- Already diagnosed and fixed this session (PR #90): tap targets, zero-line, legends, weekly-bar contrast all corrected and confirmed working against real synced Oura data.
- Sections: "LAST NIGHT" recovery snapshot (4 hero tiles: Sleep/Readiness/Night HRV/Temperature, each with a delta-vs-norm chip), detail rows (Deep sleep/REM/Time-to-first-deep/HRV recovery/Resting HR/Respiratory rate/SpO₂/Breathing disturbance), "TRENDS" with 7/30/90-day toggle and per-metric bar charts (Sleep score, Deep sleep minutes, Night HRV, Readiness score, Temperature deviation [diverging chart with legend + 0°C line], Resting HR, Steps, "High stress vs recovery" [paired bars with legend]).
- No new issues found; confirms production fix is solid.

### 2.12 `/app/insights`
- Not linked from bottom nav — reachable directly by URL. Currently always shows the nutrition empty state ("📊 No nutrition data yet — Log a meal to see your 7-day summary") for this account, since no food entries exist yet. Centered icon + heading + subtext, standard empty-state pattern used elsewhere in the app.

### 2.13 `/app/insights/medications`
- **This route is a redirect, not a real page** — `router` sends it straight to `/app/progress` (confirmed via `window.location.href` after navigation). Any reference to it as a distinct screen in specs/backlog should be corrected; there is nothing to design here beyond what's already covered in §2.10.

### 2.14 `/app/settings`
- Sections top to bottom: **Profile** (Display name, Age range select, Timezone, Save button), **Notifications** (Add-to-Home-Screen amber warning card, Push notifications toggle, Email digest toggle, Reminder lead time select, Save button), **Integrations** (Oura card, Health sync card + "Open Progress analytics" link), **About** (version, medical disclaimer, Privacy/Terms links), **Account** (Sign Out, destructive "Delete account and all data" text link), **Data Recovery** (cloud-sync status line, 4-button grid + 2-button row + a raw JSON paste textarea for manual import).
- **🟡 UI oddity**: the Oura integration card shows **both** "Connect" and "Disconnect" as separate clickable text actions side-by-side even while already connected ("Connected · Last sync: ..." + "Connect" + "Disconnect"). Showing "Connect" when already connected is confusing — likely should collapse to just "Disconnect" (or "Reconnect") once a connection exists.
- **🔴 Confirmed overflow bug**: the Data Recovery action grid ("Export snapshot" / "Backup current to cloud" / "Restore from cloud" / "Flush sync now") is laid out as a fixed 4-column grid that doesn't fit a 375px viewport — the 4th button ("Flush sync now") is visibly clipped at the right edge. Needs either a 2×2 grid or horizontal scroll/wrap at this breakpoint.
- Contains the account's real display name ("Peter Mikheev") — screenshots/specs derived from this page should redact or genericize the name before sharing outside the team.

---

## 3. Consolidated issues list (priority order)

| # | Severity | Page | Issue | Status |
|---|---|---|---|---|
| 1 | 🔴 High | `/app/food` | Meal-description input mis-nested inside header flex row → renders off-screen, untappable | ✅ Fixed 2026-07-15 — closed the header `<div>` before the meal-input row instead of after it (`src/app/app/food/page.tsx`), so it's now a sibling row, not a 3rd flex child. Verified live: input renders full-width and accepts text. |
| 2 | 🔴 High | `/app/settings` | Data Recovery 4-button grid overflows viewport, 4th button clipped | ✅ Fixed 2026-07-15 — both action rows switched to `grid grid-cols-2` (`src/app/app/settings/page.tsx`). Verified live: all 4 buttons visible in a 2×2 grid. |
| 3 | 🟡 Medium | `/app/protocols` | Protocol names hard-truncated with ellipsis well before running out of card width | ✅ Fixed 2026-07-15 — root cause was the name sharing a row with the status badge, which was itself squeezed by the icon + Resume/Pause button; name now renders on its own full-width line with the badge moved below it (`src/app/app/protocols/page.tsx`). Verified live: "Daily Essentials", "Cardiovascular Support", "Metabolic Reset", "Sleep & Recovery" all render untruncated. |
| 4 | 🟡 Medium | `/app/settings` | Oura card shows both "Connect" and "Disconnect" simultaneously while connected | ✅ Fixed 2026-07-15 — "Connect" link now only renders when `!ouraStatus?.connected`; "Disconnect" only when connected (`src/app/app/settings/page.tsx`). Verified live. |
| 5 | 🟢 Low | `/app/meds`, `/app/protocols` | Floating "✓ Synced" toast overlaps bottom nav / last list item | ✅ Fixed 2026-07-15 — idle "Synced" state now auto-fades (opacity + pointer-events) 3s after settling; still stays visible during active syncing or on error (`src/components/app/SyncStatusPill.tsx`). |
| 6 | 🟢 Low | `/onboarding` | Step-indicator label "First Protocol" wraps to 2 lines, misaligning the connector vs. steps 1 & 3 | ✅ Fixed 2026-07-15 — shortened to "Protocol" + added `whitespace-nowrap` (`src/app/(auth)/onboarding/page.tsx`). Verified live: all 3 labels single-line. |
| 7 | 🟢 Low | `/onboarding` vs `/app/settings` | Onboarding pre-fills Age range "31–50" while the account's saved profile is "51–70" | ✅ Fixed 2026-07-15 — root cause was the persisted Zustand store hydrating from localStorage *after* the component's `useState` initializers ran, so `profile` was still `undefined` at mount. Added a one-time backfill `useEffect` that syncs `name`/`ageRange` once `profile` becomes available, without clobbering anything already typed. Verified live: re-entering onboarding now shows "Peter Mikheev" / "51–70". |
| 8 | ℹ️ Info | `/app/insights/medications` | Route is a redirect to `/app/progress`, not a distinct page — remove/update any spec or backlog references treating it as separate | Not a code change — documentation correction only. |
| 9 | ℹ️ Info | `/app/protocols/[id]` | No separate read-only detail view exists — `?edit=1` and bare URL render identically | Left as-is; no clear product ask for a separate read-only view. |

---

## 4. Not captured / follow-ups

- `/register`, `/login` — blocked by auth middleware while logged in; needs a logged-out session to screenshot.
- No screenshot image files are attached to this doc (the review was done via a live authenticated preview session, not saved exports). To get pixel exports for a design tool, re-open each route above at 375×812 and export directly, or ask for a follow-up pass that saves screenshots to disk.
