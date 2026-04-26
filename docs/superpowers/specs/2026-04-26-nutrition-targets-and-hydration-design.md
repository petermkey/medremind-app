# Nutrition Targets and Hydration Design

Date: 2026-04-26
Status: Approved design for implementation planning
Branch: `codex/n3-nutrition-targets-design`

## Summary

Add guided nutrition target setup to the existing food diary. On first visit to `/app/food`, users configure a body profile and goal mode. The app generates suggested daily targets for calories, protein, fat, carbs, and fiber, then requires a manual review screen where every target can be edited before saving.

Hydration is included as a small adjacent tracker: a daily water target, manual water logging, and daily water progress. Water is not treated as a nutrient in the macro grid because it has different logging mechanics and target assumptions.

Amino acid tracking is explicitly out of scope for this stage.

## Source References

The algorithm should use conservative, documented reference points rather than unsourced fitness heuristics:

- FDA Daily Values for food-label reference values: https://www.fda.gov/food/nutrition-facts-label/daily-value-nutrition-and-supplement-facts-labels
- Mifflin-St Jeor resting metabolic rate formula, as summarized by Endotext: https://www.ncbi.nlm.nih.gov/books/NBK278991/table/diet-treatment-obes.table12est/
- International Society of Sports Nutrition position stand on protein and exercise: https://jissn.biomedcentral.com/articles/10.1186/s12970-017-0177-8
- National Academies water intake reference discussion: https://nap.nationalacademies.org/read/11537/chapter/15
- CDC general water and healthier drinks guidance: https://www.cdc.gov/healthy-weight-growth/water-healthy-drinks/index.html

## Product Scope

### In Scope

- Nutrition onboarding inside the Food section.
- Generated daily targets with manual override.
- Persisted target profile per user.
- Target-aware daily food summary at the top of `/app/food`.
- Historical day navigation for the food diary, similar to the medication schedule day selector.
- Collapsible food entry cards that keep the diary compact while preserving full meal details on demand.
- Confirmed swipe-to-delete for accidental or test food entries.
- Manual water logging and daily water progress.
- Ability to edit saved nutrition and hydration targets later.
- Focused tests for calculation logic and the main food-target flow.

### Out of Scope

- Amino acid targets or amino acid consumed estimates.
- Training-day versus rest-day target schedules.
- Weather-aware hydration recommendations.
- Sweat-rate tracking, electrolyte tracking, caffeine tracking, or sports-drink modeling.
- USDA/FoodData Central food matching.
- Medical or diagnostic claims.

## Nutrition Onboarding Flow

When a signed-in user opens `/app/food` and has no saved nutrition target profile, the page shows setup instead of the diary list.

Inputs:

- Age in years.
- Sex. The implementation can support `male`, `female`, and `other_or_prefer_not_to_say`; the neutral option should use a conservative sex-neutral calculation and make manual review prominent.
- Weight.
- Height.
- Activity level.
- Optional body fat range:
  - `<10%`
  - `10-15%`
  - `15-20%`
  - `20-25%`
  - `25%+`
  - `Unknown`
- Goal mode:
  - `bulk`
  - `lean-dry`
  - `stabilization`
  - `recomposition`

After input collection, the app shows an editable target review screen:

- Calories, kcal/day.
- Protein, g/day.
- Total fat, g/day.
- Carbs, g/day.
- Fiber, g/day.
- Water, ml/day or L/day.

The user must be able to change each generated value before saving.

## Goal Mode Definitions

`bulk`: A controlled muscle-gain phase. The algorithm uses a moderate calorie surplus to support training and lean mass gain while limiting unnecessary fat gain.

`lean-dry`: A fat-loss phase for users trying to become leaner while preserving lean mass. The algorithm uses a moderate calorie deficit and higher protein target.

`stabilization`: A maintenance phase. The algorithm targets estimated TDEE and balanced macros.

`recomposition`: A phase intended to improve body composition while keeping scale weight more stable. The algorithm targets near-maintenance calories, slightly biased toward a small deficit, with higher protein.

## Target Algorithm

Create a pure calculation module, for example `src/lib/food/targetAlgorithm.ts`. React components should not contain formula logic.

### RMR

Use Mifflin-St Jeor:

- Male: `10 * weightKg + 6.25 * heightCm - 5 * ageYears + 5`
- Female: `10 * weightKg + 6.25 * heightCm - 5 * ageYears - 161`
- Neutral/unspecified: average the male and female outputs, then rely on manual review before save.

### TDEE

Use `RMR * activityMultiplier`.

Initial activity levels:

- `sedentary`: `1.2`
- `light`: `1.375`
- `moderate`: `1.55`
- `high`: `1.725`
- `athlete`: `1.9`

Labels should be practical, not clinical. Example: "Moderate - training 3-5 days/week".

### Calories by Mode

Initial deterministic modifiers:

- `bulk`: `TDEE * 1.08`
- `lean-dry`: `TDEE * 0.82`
- `stabilization`: `TDEE * 1.00`
- `recomposition`: `TDEE * 0.95`

Round calories to the nearest 25 kcal.

### Body Fat Range Handling

Body fat range is optional and low-confidence. Use it only to refine lean-mass-aware targets; do not present it as a diagnosis or precise measurement.

Use midpoint estimates:

- `<10%`: `0.09`
- `10-15%`: `0.125`
- `15-20%`: `0.175`
- `20-25%`: `0.225`
- `25%+`: `0.275`
- `Unknown`: no lean mass estimate

Estimated lean mass:

`leanMassKg = weightKg * (1 - bodyFatMidpoint)`

If body fat is unknown, compute protein from total body weight. If body fat is known, use lean mass to prevent excessive protein targets for higher bodyweight users, but keep a reasonable floor based on total body weight.

### Protein

Initial protein factors:

- `bulk`: `1.8 g/kg`
- `lean-dry`: `2.2 g/kg`
- `stabilization`: `1.6 g/kg`
- `recomposition`: `2.0 g/kg`

If body fat range is known:

- Primary estimate: `leanMassKg * modeProteinFactor * 1.15`
- Floor: `weightKg * 1.4`
- Use the greater of those two values.

If body fat range is unknown:

- Use `weightKg * modeProteinFactor`.

Round protein to the nearest 5 g.

### Fat

Use mode-based calorie percentages with a minimum floor:

- `bulk`: `25%` of calories
- `lean-dry`: `22%` of calories
- `stabilization`: `28%` of calories
- `recomposition`: `25%` of calories

Minimum: `0.6 g/kg` bodyweight.

Round fat to the nearest 5 g.

### Carbs

Compute carbs from remaining calories after protein and fat:

`carbsG = (calories - proteinG * 4 - fatG * 9) / 4`

If the value is below a practical floor, clamp to the floor and surface that generated targets may be calorie-constrained:

- `lean-dry`: minimum `1.5 g/kg`
- all other modes: minimum `2.0 g/kg`

Round carbs to the nearest 5 g.

### Fiber

Base fiber on calories with an FDA-style reference floor:

- `fiberG = max(25, calories / 1000 * 14)`

Round fiber to the nearest 1 g.

### Water

Water target is a drink-water target, not a total-water-from-all-sources claim.

Initial target:

`waterMl = weightKg * 35`

Activity adjustment:

- `sedentary`: `+0 ml`
- `light`: `+250 ml`
- `moderate`: `+500 ml`
- `high`: `+750 ml`
- `athlete`: `+1000 ml`

Round to the nearest 250 ml.

Manual override is required in the review screen because water needs vary substantially with climate, sweat rate, training duration, and diet.

## UI Design

### Food Summary

Use the selected `Grid Cards` layout.

Top cards:

- Calories
- Protein
- Fat
- Carbs
- Fiber

Each card shows:

- `consumed / target`
- progress bar
- `left` when under target
- `over by X` when above target

Example:

`1,140 / 2,650 kcal`

`1,510 left`

### Day Navigation

The Food page should support scrolling back through past days, similar to the medication schedule.

Default behavior:

- Open on the user's current local date.
- Provide a horizontal date strip or equivalent date selector above the target summary.
- Allow selecting yesterday, earlier days, and returning to today.
- The selected date drives food totals, hydration totals, entries, and the target card progress.
- Global nutrition and hydration targets apply to every selected date in this slice.

Data behavior:

- Load a range around the selected date rather than only the current day.
- Use the user's resolved timezone when deciding which entries belong to a local date.
- If the user logs food while a past date is selected, save the entry against the selected local date using the current local time as the default time. Full time editing is out of scope for this slice.

### Hydration Summary

Show hydration as a compact, separate tracker near the top of `/app/food`, below or adjacent to the food target cards.

It should show:

- `Water`
- `consumed / target`
- `left` or `over by`
- quick add buttons: `+250 ml`, `+500 ml`

Example:

`Water 1.2 / 2.8 L - 1.6 L left`

Hydration progress follows the selected date. Quick-add water logs should be added to the selected local date, matching the food logging rule.

### Food Entry Cards

Food entries appear below the target and hydration summaries.

Each entry should be collapsible:

- Collapsed state shows compact summary information only:
  - time
  - meal title
  - calories
  - protein, fat, carbs, and fiber when available
  - confidence/source hint for photo-estimated entries
- Expanded state shows full details:
  - meal summary
  - component list
  - component quantities and confidence
  - uncertainties
  - detailed nutrient values shown today
- Cards should default to collapsed after save and when opening a day with existing entries.
- The user can tap a collapsed card to expand it and tap again to collapse it.

### Food Entry Delete

Users must be able to delete accidental or test food entries.

Interaction:

- Swipe a food entry card left to reveal a destructive delete action.
- Tapping delete opens a confirmation prompt.
- Confirming deletes the entry and its components from the selected day's diary.
- Canceling returns the card to its normal state without deleting.

Deletion behavior:

- Delete is optimistic locally: the entry disappears immediately after confirmation.
- The cloud delete must be durable through the sync outbox.
- If sync is offline or fails, the pending delete remains queued and retried.
- Food totals and target progress recalculate immediately after local delete.
- Delete should be available for current and historical dates.

### Edit Targets

Add an edit action from the Food page that reopens the target setup/review flow with current values prefilled.

The user can update:

- body inputs
- goal mode
- generated targets
- manually overridden targets
- water target

## Persistence Design

Add persisted tables separate from `food_entries`.

### `nutrition_target_profiles`

One active target profile per user for this stage.

Suggested fields:

- `id uuid primary key`
- `user_id uuid not null references profiles(id) on delete cascade`
- `age_years int not null`
- `sex text not null`
- `weight_kg numeric not null`
- `height_cm numeric not null`
- `activity_level text not null`
- `body_fat_range text not null default 'unknown'`
- `goal_mode text not null`
- `calories_kcal int not null`
- `protein_g int not null`
- `fat_g int not null`
- `carbs_g int not null`
- `fiber_g int not null`
- `water_ml int not null`
- `algorithm_version text not null`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Add RLS owner access policy, consistent with `food_entries`.

### `water_entries`

Manual hydration logs.

Suggested fields:

- `id uuid primary key`
- `user_id uuid not null references profiles(id) on delete cascade`
- `consumed_at timestamptz not null`
- `timezone text not null default 'UTC'`
- `amount_ml int not null`
- `source text not null default 'manual'`
- `created_at timestamptz not null default now()`

Add RLS owner access policy and an index on `(user_id, consumed_at desc)`.

### Food Entry Deletion

Deleting a food entry should remove the parent `food_entries` row. `food_entry_components` already has a cascading foreign key and should be deleted by the database.

Implementation decision:

- Hard delete `food_entries` by `(id, user_id)` with outbox retry.
- The local store should track pending deleted IDs while the outbox is waiting, so a background pull does not reintroduce an entry that the user already confirmed for deletion.
- Soft deletes are out of scope for this slice.

## Client State Design

Keep target and hydration state separate from the existing food entry store where practical.

Suggested modules:

- `src/types/nutritionTargets.ts`
- `src/lib/food/targetAlgorithm.ts`
- `src/lib/food/hydration.ts`
- `src/lib/supabase/nutritionTargetsSync.ts`
- `src/lib/store/nutritionTargetsStore.ts`

The current `foodStore` should continue owning food entries, food totals, and food sync behavior.

The new store owns:

- current target profile
- target loading/saving
- water entries
- water totals for date
- quick-add water action

The existing food store should add:

- selected-date-aware entry derivation
- optimistic delete
- durable `foodEntryDelete` outbox operation
- pending delete filtering during pulls

## Error Handling

- If target profile loading fails, keep the food diary usable and show a non-blocking "Targets unavailable" state.
- If target saving fails, keep form values in memory and show retry.
- If no target profile exists, show onboarding rather than silently using defaults.
- If water logging fails, use the same optimistic local write plus durable retry pattern as food entry saves.
- If food deletion sync fails, keep the delete queued and show the existing sync status pattern rather than restoring the deleted card.
- Invalid inputs should be rejected before calculation with clear field-level messages.

## Validation Rules

Initial validation bounds:

- Age: `13-100`
- Weight: `30-250 kg`
- Height: `120-230 cm`
- Targets: positive integers
- Water target: `500-8000 ml`
- Water log amount: `50-3000 ml`

These bounds are product safety rails, not clinical claims.

## Testing Plan

### Unit Tests

Add tests around the pure target algorithm:

- Valid inputs produce positive rounded targets.
- Each goal mode changes calories in the expected direction.
- Body fat `Unknown` does not break calculation.
- Body fat ranges influence protein without creating unrealistic outputs.
- Carbs are derived from remaining calories and respect the floor.
- Water target changes with weight and activity level.
- Invalid inputs are rejected.

### E2E Smoke

Extend the authenticated food E2E coverage:

- First `/app/food` visit with no target profile shows nutrition onboarding.
- Completing onboarding shows Grid Cards with saved targets.
- The date selector can move to yesterday and back to today, with selected-day totals updating.
- Saving a food photo increases consumed values and reduces remaining values.
- Food entry cards render collapsed by default and can expand to show component details.
- Swipe-left delete asks for confirmation, removes the entry, and updates totals.
- Editing targets updates the top cards.
- Quick-add water increases daily water progress.

## Documentation Updates

Implementation should update:

- `README.md` functional scope and environment notes if needed.
- Current status docs if this feature lands.
- Any Supabase migration index or setup notes used by this repository.

## Implementation Decisions

- Target profile saves and water entry saves should use the same optimistic local write plus durable outbox retry pattern as food entries.
- First-time setup has no skip path in this slice. If no target profile exists, `/app/food` shows onboarding before the diary experience.
