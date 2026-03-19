# Current Status and Next Phase (Current Main)

Date: 2026-03-19
Source: current `main`

## 1. What is stable on main now

Auth and onboarding hardening in place:

- confirmation-aware register flow (`hasSession` branch)
- register confirmation resend action
- resend cooldown on confirmation actions (register + login)
- onboarding profile save is non-blocking
- app layout boot no longer stays indefinitely in spinner on auth bootstrap failure

Protocol and schedule hardening in place:

- protocol finalization ID hardening and guarded ID fallback generation
- fixed-duration validation at protocol creation entry
- inclusive `endDate` assignment on activation for fixed-duration protocols
- immediate active-dose reconciliation when duration changes on active protocols
- live protocol resolution in regeneration path

Persistence and sync hardening in place:

- deterministic import ID mapping for protocol-related restore entities
- signup profile ID safeguard via store ID generator
- logout/sign-out guard waits for in-flight sync and outbox with confirmation gates

UI/accessibility hardening in place:

- swipe targeting stabilization for row/card interactions
- accessibility labels for protocol/dose secondary row actions
- explicit schedule action labels and button semantics

## 2. Latest accepted scoped commits (recent)

Recent landed sequence includes:

- `4a8b991` defensive `normalizeDurationDays`
- `3767b86` auth confirmation error normalization/resend feedback
- `05cc63c` explicit labels for secondary row actions
- `73be30e` docs update
- `3358a3f` duration change active-dose reconciliation
- `42b741e` auth resend cooldown
- `df16edf` schedule accessibility labels

(Plus earlier scoped slices listed in the handoff doc.)

## 3. Known fragile areas still present

- Auth routing semantics remain split between proxy and client layout bootstrap.
- Domain engine logic remains centralized in `store.ts` (high coupling).
- Outbox is client-local and may accumulate operations under prolonged failures.
- PWA has manifest/icons but no explicit service-worker runtime path on current main.

## 4. Deferred larger initiatives (not piecemeal from old mixed branches)

### Track A: Auth and email confirmation redesign

Why deferred:

- Remaining issues are flow-level and policy-level, not single-line regressions.
- Requires cohesive auth state model validation across proxy + layout + auth pages.

Problem space:

- explicit states/transitions for signup confirmation, sign-in, onboarding, and failure fallback.

Safe-first approach from main:

- design explicit auth state machine document + one narrow implementation slice at a time.

### Track B: Domain and schedule engine redesign

Why deferred:

- Core patches are landed, but remaining work is rules coherence and test depth.

Problem space:

- recurrence boundaries, reconciliation semantics, and future extensibility of schedule rules.

Safe-first approach from main:

- codify one domain rule set + tests, then ship in small isolated slices.

### Track C: UI and PWA pack audit

Why deferred:

- Medium impact compared with auth/domain correctness.
- Includes broader polish and runtime packaging concerns.

Problem space:

- consistency, interaction polish, remaining accessibility semantics, install/offline expectations.

Safe-first approach from main:

- targeted audit list -> isolated UI/PWA polish patches.

## 5. What not to do in next phase

- Do not revive retired mixed branches.
- Do not merge large multi-concern bundles.
- Do not bypass email confirmation policy with local auth shortcuts.
- Do not rewrite schedule engine broadly before extracting testable rules.

## 6. Recommended operating model

For each track:

1. branch from current `main`
2. implement one isolated slice
3. run focused validation + `npm run build`
4. merge single validated commit
5. reassess before next slice

This repository now depends on strict scoped-slice discipline for safe progress.
