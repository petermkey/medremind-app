# Medication Knowledge Layer Design

Date: 2026-04-26
Status: approved design direction for implementation planning

## Goal

Build a hybrid medication knowledge layer that reads the user's active medication map, normalizes drugs into stable clinical identifiers/classes, enriches them with curated lifestyle rules and public evidence references, and feeds medication-aware features into the personalized correlation engine.

The first product target is not a generic drug database UI. The goal is to make MedRemind understand what a user is taking well enough to support nutrition, hydration, activity, sleep, stress, and adherence analysis.

## Product Boundary

The layer can generate:

- Medication-aware nutrition priorities, such as higher protein priority for GLP-1 users.
- Hydration, fiber, meal-size, and GI-tolerance prompts when relevant.
- Activity/recovery considerations, such as resistance training emphasis for GLP-1 users or recovery-aware training prompts for testosterone users.
- Monitoring prompts based on known medication class concerns.
- Clinician-review flags when medication timing, symptoms, or biomarker/lifestyle patterns may deserve professional review.

The layer must not generate direct user instructions to stop, pause, reschedule, reduce, increase, or otherwise change a prescription medication. Medication-change output remains clinician-review only.

## Current App Context

MedRemind already has the core data needed to start:

- `Drug`: `name`, `genericName`, `category`, `commonDoses`, `routes`, `notes`, `isCustom`.
- `ProtocolItem`: `drugId`, `doseAmount`, `doseUnit`, `doseForm`, `route`, `frequencyType`, `times`, `withFood`, `instructions`.
- `ScheduledDose` and `DoseRecord`: actual planned and handled medication events.
- Food diary and hydration data.
- Oura integration work in progress for sleep, readiness, activity, stress, SpO2, VO2 max, workouts, and heart-rate data.

The current seed catalogue already includes high-value targets for the first ruleset: semaglutide, testosterone, metformin, insulin glargine, levothyroxine, statins, beta blockers, SSRIs, melatonin, magnesium, creatine, iron, calcium, and common supplements.

## Recommended Approach: Hybrid Knowledge Layer

Use a hybrid model:

1. **Curated class rules** for the highest-value medication classes and supplements.
2. **RxNorm/RxClass normalization** for stable identifiers, ingredients, and class matching.
3. **DailyMed/openFDA references** for evidence-backed label sections, warnings, adverse reactions, and interaction summaries.
4. **Manual fallback classification** for custom or non-US supplements that cannot be normalized confidently.

This gives deterministic behavior for the classes MedRemind cares about most while avoiding brittle parsing of free-text labels for every product.

## Source Systems

### RxNorm and RxClass

Use RxNorm/RxClass for normalization:

- Resolve user-entered drug names and generic names into RxCUIs.
- Identify ingredients and brand/generic relationships.
- Retrieve class membership where available.
- Store normalization confidence and source.

RxNorm is the primary terminology layer because it provides normalized clinical drug names and links to other drug vocabularies.

### DailyMed and openFDA

Use DailyMed/openFDA as evidence-reference sources:

- DailyMed labels include prescribing information, warnings, precautions, adverse reactions, interactions, dosage/administration, contraindications, and use in specific populations.
- openFDA drug label API exposes structured label sections as JSON.

These sources should not be parsed directly into automatic patient advice without curated transformation. They should attach references and evidence snippets to curated rules.

### Curated MedRemind Rules

Create a small curated rule library for the first implementation:

- GLP-1 receptor agonists: semaglutide, tirzepatide, liraglutide, dulaglutide where relevant.
- Testosterone and related hormonal support: testosterone, HCG, anastrozole.
- Metabolic/glucose drugs: metformin, insulin, berberine, alpha lipoic acid.
- Cardiovascular drugs: statins, beta blockers, ACE inhibitors, ARBs, calcium channel blockers, aspirin.
- Thyroid medication: levothyroxine.
- Sleep/neuroactive: SSRIs, melatonin, magnesium, ashwagandha.
- Common supplement interactions/considerations: iron, calcium, zinc, creatine, omega-3.

## Data Model

### Medication Knowledge Entity

Each medication or class should resolve to a normalized knowledge record:

- `knowledge_id`
- `drug_name`
- `generic_name`
- `rxnorm_rxcui`
- `ingredients`
- `class_codes`
- `class_labels`
- `route_relevance`
- `dose_form_relevance`
- `source_confidence`
- `evidence_sources`
- `last_reviewed_at`

### Lifestyle Rule Entity

Each curated rule should be structured, not prose-only:

- `rule_id`
- `applies_to`: RxCUI, ingredient, drug class, or local seed drug id.
- `domain`: nutrition, hydration, activity, sleep, stress, adherence, lab_monitoring, medication_review.
- `trigger`: active medication, dose escalation phase, injection day offset, adherence mismatch, side-effect pattern, low intake, high stress, low recovery.
- `effect`: target adjustment, insight generation, monitoring prompt, correlation feature.
- `recommendation_kind`: lifestyle_adjustment, tracking_prompt, clinician_review.
- `risk_level`: low, medium, high.
- `evidence_refs`: DailyMed/openFDA/RxNorm/clinical advisory URLs.

### Medication Exposure Feature

The correlation engine needs a daily feature map:

- `has_glp1_active`
- `days_since_glp1_start`
- `glp1_dose_escalation_phase`
- `has_testosterone_active`
- `testosterone_injection_day_offset`
- `has_beta_blocker_active`
- `has_thyroid_med_active`
- `has_ssri_active`
- `with_food_mismatch_count`
- `late_medication_count`
- `missed_medication_count`
- `medication_class_exposure_score`
- `medication_review_signal_count`

## First-Party Medication Map Reader

The map reader should derive the user's medication context from current app state and Supabase rows:

1. Active protocols.
2. Active protocol items where `itemType === 'medication'`.
3. Linked `Drug` rows where available.
4. Dose schedule and actual dose records.
5. Timing relationship to food where available.
6. Start/end dates and current lifecycle status.
7. Recent misses, snoozes, and late actions.

The output should be independent from UI components and usable by both background jobs and API routes.

## Rule Examples

### GLP-1 Class

Inputs:

- Semaglutide/tirzepatide/liraglutide active.
- Dose escalation phase.
- Food entries showing low calories or low protein.
- Hydration entries showing low water.
- Oura readiness/activity showing reduced recovery or reduced activity.

Outputs:

- Increase protein priority.
- Emphasize resistance training to preserve lean mass.
- Monitor low-calorie days and micronutrient risk.
- Suggest smaller, nutrient-dense meals when GI tolerance is poor.
- Suggest hydration/fiber support when intake is low.

Evidence direction:

- 2025 lifestyle/nutrition advisory for GLP-1 therapy emphasizes baseline nutrition assessment, GI side-effect management, nutrient-dense minimally processed diets, prevention of micronutrient deficiencies, adequate protein intake, and strength training to preserve lean mass.

### Testosterone Class

Inputs:

- Testosterone active.
- Injection schedule and day offset.
- Oura recovery/stress/sleep/HR trends.
- Activity/training volume.
- Future lab/BP data when available.

Outputs:

- Recovery-aware strength training prompts.
- Cardio strain and poor-recovery watch prompts.
- Clinician-review flags when cardiovascular strain markers are persistently concerning.
- Lab-monitoring reminders if protocol includes analysis items.

Evidence direction:

- FDA labeling updates added class-wide blood-pressure warning language for testosterone products. Testosterone labels also commonly include monitoring concerns such as hematocrit/polycythemia and cardiovascular risk context.

### Levothyroxine

Inputs:

- Levothyroxine active.
- Timing and food relationship.
- Calcium/iron co-use.
- Missed or late doses.

Outputs:

- Adherence and timing consistency prompts.
- Food/supplement spacing prompt as clinician-review/education content.
- Correlation features for energy/readiness/sleep patterns.

### SSRIs

Inputs:

- Sertraline/escitalopram active.
- Sleep timing, sleep score, stress, readiness.
- Dose timing if known.

Outputs:

- Sleep/stress tracking prompt.
- Clinician-review flag if medication timing patterns repeatedly align with poor sleep.

## Insight Output Levels

The medication layer should produce three levels of output:

1. **Profile facts**
   - "You have an active GLP-1 medication in your protocol."
   - "This medication profile is relevant to appetite, GI tolerance, protein intake, and resistance training."

2. **Lifestyle recommendations**
   - "Protein is under target on 5 of the last 7 days while GLP-1 is active."
   - "Consider planning a protein-forward first meal."
   - "Resistance training was absent this week while weight-loss medication is active."

3. **Clinician-review flags**
   - "A recurring pattern links medication timing with poor sleep. Review timing with your clinician before changing it."
   - "Cardio strain markers look elevated while testosterone is active. Review this with your clinician if it persists."

## Integration With Correlation Engine

The personalized correlation engine should consume the medication layer as an upstream feature provider.

Flow:

1. Medication map reader builds active medication exposures.
2. Normalizer enriches each medication with RxNorm/class identifiers.
3. Curated rule engine creates lifestyle implications and feature flags.
4. Daily feature builder adds medication features to lifestyle/Oura/food/hydration snapshots.
5. Correlation engine ranks patterns across 30/60/90-day windows.
6. Insight generator emits cards with evidence, confidence, and safe recommendation kind.

Medication features should be computed before statistical correlation so the engine can answer questions like:

- Are low-protein days more frequent during GLP-1 active periods?
- Do skipped meals or low hydration cluster around GLP-1 injection days?
- Does testosterone injection day offset correlate with sleep/recovery/activity changes?
- Are missed medications more likely after high-stress or poor-sleep days?

## Consent and UX Requirements

Before using medication knowledge for analysis, the user must explicitly opt in to:

- Medication map analysis.
- Combining medication data with food/hydration data.
- Combining medication data with wearable/Oura data.
- Receiving clinician-review flags.

The UX should make clear:

- This is pattern analysis.
- Medication-change decisions require clinician review.
- The user can disconnect Oura and disable medication analysis.
- The app stores normalized medication knowledge and daily exposure features.

## MVP Scope

The first implementation should include:

1. Schema for medication knowledge records, curated rules, medication mappings, and daily exposure features.
2. Static curated rules for:
   - GLP-1 receptor agonists.
   - Testosterone.
   - Levothyroxine.
   - SSRIs.
   - Metformin/insulin.
   - Statins/beta blockers.
   - Iron/calcium/magnesium/zinc/creatine/omega-3.
3. Name-based matching against seed drugs and user custom drugs.
4. Optional RxNorm lookup for normalization.
5. Medication map reader from active protocols and dose records.
6. Daily medication exposure feature builder.
7. Integration points for the correlation engine.
8. A simple Medication Intelligence debug/admin surface or API endpoint for reviewing matched classes and generated features.

## Deferred Scope

Do not implement these in the first slice:

- Automatic parsing of arbitrary DailyMed labels into live rules.
- Full drug-drug interaction engine.
- Lab result ingestion and lab-aware medication recommendations.
- Dose titration guidance.
- Autonomous protocol changes.
- Direct medication stop/pause/reschedule recommendations.
- International drug terminology beyond RxNorm-backed matching.

## Risks

- User-entered medication names can be ambiguous.
- Supplements may not normalize cleanly through RxNorm.
- Label text is not directly equivalent to personalized advice.
- Correlation is not causation, especially across 30-90 days.
- Medication-related wording can drift into unsafe advice if not constrained by typed recommendation kinds and tests.

## Success Criteria

- The app can read a user's active medication protocol and produce a normalized medication profile.
- GLP-1 and testosterone examples produce structured lifestyle implications.
- Daily medication exposure features can be joined with Oura, food, hydration, and adherence snapshots.
- Medication-change output is limited to clinician-review flags.
- Curated rule output is explainable and links back to evidence references.
- Custom/unknown drugs produce low-confidence profile entries rather than silent failure.

## Open Product Decisions

1. Whether the first UI should be hidden/debug-only or user-facing.
2. Whether medication analysis opt-in should live in Settings or in the Insights onboarding flow.
3. Whether RxNorm lookup should happen synchronously on medication creation or asynchronously in a background enrichment job.
4. Whether curated rules should ship as TypeScript constants first or as Supabase-managed rows from the beginning.
