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

## AI Model Stack

AI should be used as an interpretation and summarization layer, not as the source of truth for medication facts. The source of truth remains structured first-party app data, curated rules, RxNorm/RxClass identifiers, DailyMed/openFDA label references, and Oura/food/hydration records.

Use OpenRouter as the AI provider for this layer. The app should call the OpenRouter OpenAI-compatible Chat Completions endpoint:

- `OPENROUTER_API_BASE_URL`: default `https://openrouter.ai/api/v1`.
- `OPENROUTER_API_KEY`: required for AI-assisted pipelines.
- `OPENROUTER_HTTP_REFERER`: default `NEXT_PUBLIC_APP_URL`.
- `OPENROUTER_APP_TITLE`: default `MedRemind`.

Use model aliases through environment variables so the stack can be upgraded without schema changes:

- `MED_KNOWLEDGE_FAST_MODEL`: default `google/gemini-2.5-flash`.
- `MED_KNOWLEDGE_REASONING_MODEL`: default `anthropic/claude-sonnet-4.5`.
- `MED_KNOWLEDGE_SECOND_OPINION_MODEL`: default `google/gemini-2.5-pro`.
- `MED_KNOWLEDGE_NANO_MODEL`: default `google/gemini-2.5-flash-lite`.
- `MED_KNOWLEDGE_LONG_CONTEXT_MODEL`: default `qwen/qwen3.6-plus`.
- `MED_KNOWLEDGE_AUTO_FALLBACK_MODEL`: default `openrouter/auto`.

Provider routing rules:

- Use `require_parameters: true` for requests that require `response_format` / `structured_outputs`.
- Use strict `response_format: { type: "json_schema", json_schema: { strict: true, ... } }` where the chosen model supports it.
- Use OpenRouter `models` fallback arrays for non-critical tasks only; do not fallback silently for medication safety validation.
- Include `HTTP-Referer` and `X-OpenRouter-Title` headers for app attribution.
- Store returned `model`, `usage`, and selected provider metadata in `ai_runs` when available.

The planned OpenRouter usage is:

1. **Fast classification and extraction**
   - Model: `MED_KNOWLEDGE_FAST_MODEL`, default `google/gemini-2.5-flash`.
   - API: OpenRouter Chat Completions with strict structured outputs.
   - Input: normalized medication name, candidate RxNorm/RxClass matches, curated class list, label section snippets.
   - Output: strict JSON `MedicationClassificationCandidate`.
   - Use cases: ambiguous custom drug classification, supplement class mapping, extraction of lifestyle-relevant label facts into a controlled schema.

2. **High-confidence clinical/lifestyle reasoning review**
   - Model: `MED_KNOWLEDGE_REASONING_MODEL`, default `anthropic/claude-sonnet-4.5`.
   - API: OpenRouter Chat Completions with strict structured outputs and `require_parameters: true`.
   - Input: deterministic features, matched rules, evidence references, Oura/food/hydration aggregate summaries, correlation results.
   - Output: strict JSON `InsightDraftReview`.
   - Use cases: resolving conflicting rules, explaining why an insight is or is not strong enough, choosing clinician-review vs lifestyle prompt language.

3. **Second-opinion review for high-risk medication-adjacent cards**
   - Model: `MED_KNOWLEDGE_SECOND_OPINION_MODEL`, default `google/gemini-2.5-pro`.
   - API: OpenRouter Chat Completions with strict structured outputs.
   - Input: candidate card, evidence references, deterministic rule trace, safety validator result.
   - Output: strict JSON `SecondOpinionReview`.
   - Use cases: independent review before persisting high-severity clinician-review cards.

4. **Low-cost routing and deduplication**
   - Model: `MED_KNOWLEDGE_NANO_MODEL`, default `google/gemini-2.5-flash-lite`.
   - API: OpenRouter Chat Completions with structured outputs when supported.
   - Input: existing card titles/bodies and a new candidate card.
   - Output: strict JSON `InsightDeduplicationDecision`.
   - Use cases: grouping similar insights, classifying a candidate into nutrition/hydration/activity/sleep/stress/medication-review buckets, short copy variants.

5. **Long-context evidence summarization**
   - Model: `MED_KNOWLEDGE_LONG_CONTEXT_MODEL`, default `qwen/qwen3.6-plus`.
   - API: OpenRouter Chat Completions with structured outputs and long-context input limits.
   - Input: compacted DailyMed/openFDA label sections, RxNorm/RxClass metadata, curated rule candidates.
   - Output: strict JSON `EvidenceSummary`.
   - Use cases: summarizing large label sections into evidence cards that still cite source section names and URLs.

6. **Evidence retrieval and semantic matching**
   - Primary approach: deterministic lexical matching by RxCUI, ingredient, class code, alias, and content hash.
   - Optional AI-assisted approach: OpenRouter model-based reranking of a small candidate set using `MED_KNOWLEDGE_FAST_MODEL`.
   - Do not rely on OpenRouter for embeddings in the first slice unless a selected OpenRouter-compatible embedding endpoint is explicitly added. If vector search is needed before then, defer embeddings or use Supabase text search plus deterministic aliases.

7. **Existing food photo analysis**
   - Prefer the existing OpenRouter provider path for AI food analysis.
   - The medication knowledge layer consumes confirmed food entries and nutrients, not raw food-photo model output.

All model outputs must be treated as proposed structured data. They must pass deterministic validation before persistence:

- Schema validation through OpenRouter structured outputs where supported.
- Medication safety language validator.
- Evidence reference requirement for medication-related claims.
- Confidence thresholding.
- No direct prescription medication-change actions.

OpenRouter's API supports OpenAI-compatible chat completions, app attribution headers, usage reporting, provider/model routing, and structured outputs for compatible models. Because model support changes over time, implementation must check OpenRouter model metadata for `structured_outputs` / `response_format` support during model selection and fail closed when a required parameter is unavailable.

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

### Evidence Document Entity

Store external evidence as normalized, versioned references:

- `evidence_id`
- `source`: rxnorm, rxclass, dailymed, openfda, curated_rule, clinical_advisory.
- `source_url`
- `source_version`
- `source_retrieved_at`
- `title`
- `section_name`
- `content_hash`
- `content_excerpt`
- `retrieval_strategy`: lexical, model_rerank, vector.
- `embedding_model`
- `embedding_vector`
- `review_status`: unreviewed, curated, rejected.

The app should store excerpts and metadata needed for explainability. It should not blindly persist large raw labels unless a retention policy is defined.

### AI Run Entity

Every AI-assisted classification or insight review should be auditable:

- `ai_run_id`
- `user_id`
- `pipeline_name`
- `model`
- `model_version`
- `provider`
- `openrouter_generation_id`
- `usage_prompt_tokens`
- `usage_completion_tokens`
- `usage_total_tokens`
- `input_hash`
- `output_json`
- `source_evidence_ids`
- `validation_status`
- `validation_errors`
- `created_at`

Do not store raw prompts containing more user data than needed. Store input hashes and compact structured summaries where possible.

### Sync and Job Entity

Longer-running processing should be idempotent and resumable:

- `job_id`
- `user_id`
- `job_type`: medication_map_refresh, medication_normalization, evidence_refresh, daily_feature_build, insight_generation.
- `status`: queued, running, completed, failed, cancelled.
- `idempotency_key`
- `input_window_start`
- `input_window_end`
- `attempt_count`
- `last_error`
- `created_at`
- `updated_at`

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

## Processing Pipelines

### Pipeline 1: Medication Map Refresh

Trigger moments:

- User creates or edits a protocol item.
- User activates, pauses, resumes, completes, or archives a protocol.
- User imports/restores a snapshot.
- Nightly background refresh for active users.
- Manual "refresh medication intelligence" action in Settings or Insights.

Steps:

1. Read active protocols and medication items from Supabase.
2. Join linked `drugs` rows and custom drug fields.
3. Build canonical medication exposure records by active protocol, item, dose, route, schedule, and start/end dates.
4. Upsert medication map rows with stable idempotency keys.
5. Queue normalization jobs for new or changed medication identities.

Storage:

- Supabase `medication_map_items`.
- Derived daily exposure rows in `daily_medication_exposures`.

### Pipeline 2: Drug Normalization

Trigger moments:

- New medication map item.
- Drug name/generic/route/dose form changes.
- Scheduled periodic refresh for low-confidence mappings.

Steps:

1. Try exact seed-drug match by `drugId`.
2. Try deterministic name/generic matching against local aliases.
3. Query RxNorm by name/generic name.
4. Query RxClass for class membership when RxCUI exists.
5. If multiple candidates remain, call `MED_KNOWLEDGE_FAST_MODEL` with candidate list and require strict JSON classification.
6. Persist normalized match, confidence, source, and ambiguity notes.
7. Unknown drugs remain usable but marked low-confidence.

Storage:

- Supabase `medication_normalizations`.
- Supabase `medication_knowledge_records`.
- `ai_runs` only when AI disambiguation is used.

### Pipeline 3: Evidence Refresh

Trigger moments:

- New normalized medication/class.
- Curated rule version changes.
- Weekly scheduled refresh for evidence cache.
- Manual admin refresh.

Steps:

1. Fetch RxNorm/RxClass metadata.
2. Fetch DailyMed/openFDA label sections where available.
3. Extract only relevant sections: warnings, precautions, adverse reactions, drug interactions, dosage/administration, patient counseling information.
4. Chunk and hash evidence excerpts.
5. Index evidence by source, ingredient aliases, class labels, section names, and content hash.
6. Optionally rerank a small evidence candidate set with `MED_KNOWLEDGE_FAST_MODEL`.
7. Link evidence to curated rules and medication knowledge records.

Storage:

- Supabase `medication_evidence_documents`.
- Supabase text-search indexes for the MVP.
- Supabase vector column or `pgvector` companion table only if an embedding provider is explicitly added later.
- Evidence refresh jobs and `content_hash` values for idempotency.

### Pipeline 4: Curated Rule Evaluation

Trigger moments:

- Medication map refresh completed.
- Food, hydration, Oura, or dose data changes for the current day.
- Daily scheduled insight build.

Steps:

1. Load active medication knowledge profile.
2. Load curated rules applicable by class, ingredient, route, dose form, or local drug id.
3. Evaluate deterministic triggers first.
4. Produce lifestyle implications and medication exposure features.
5. Pass only eligible candidates to AI review when explanation quality or conflict resolution is needed.
6. Validate all output through medication safety guardrails.

Storage:

- Supabase `medication_rule_evaluations`.
- Derived flags in `daily_medication_exposures`.
- Insight candidates in `correlation_insight_cards` only after validation.

### Pipeline 5: Daily Lifestyle Snapshot Build

Trigger moments:

- Daily scheduled job after Oura sync.
- User confirms food entry.
- User logs water.
- User records a dose action.
- User requests insight generation.

Steps:

1. Pull medication exposure features.
2. Pull food daily totals.
3. Pull water totals.
4. Pull dose adherence and timing facts.
5. Pull Oura daily summaries and selected time-series aggregates.
6. Build a complete day-level feature vector.
7. Upsert into daily snapshot table by `(user_id, local_date)`.

Storage:

- Supabase `daily_lifestyle_snapshots`.
- Oura raw normalized daily tables from the Oura integration layer.
- Food and hydration tables already present in the app.

### Pipeline 6: Correlation and AI Insight Review

Trigger moments:

- Nightly after snapshot build.
- User requests 30/60/90-day insight refresh.
- Significant medication map change.

Steps:

1. Load 30/60/90-day snapshots.
2. Compute deterministic statistics and thresholds.
3. Generate candidate insight cards.
4. Use `MED_KNOWLEDGE_REASONING_MODEL` only for high-value explanation review, conflict resolution, and safe phrasing.
5. Use `MED_KNOWLEDGE_SECOND_OPINION_MODEL` for high-severity medication-adjacent cards.
6. Use `MED_KNOWLEDGE_NANO_MODEL` for deduplication and bucket routing when needed.
7. Enforce structured output schema through OpenRouter `response_format`.
8. Run medication safety validator.
9. Persist approved cards with evidence and model provenance.

Storage:

- Supabase `correlation_insight_cards`.
- Supabase `ai_runs`.
- Dismissal and feedback fields on insight cards.

## Synchronization and Storage Model

The system should distinguish source data, normalized data, derived features, and generated insights.

### Source Data

Owned by existing systems:

- Medication protocols, scheduled doses, and dose records in MedRemind/Supabase.
- Food entries and components in MedRemind/Supabase.
- Water entries and nutrition targets in MedRemind/Supabase.
- Oura OAuth tokens and Oura API pulls through the Oura integration layer.

Source data is never overwritten by the medication knowledge layer.

### Normalized Data

Stored in Supabase:

- Medication map items.
- RxNorm/RxClass mappings.
- Medication knowledge records.
- Evidence documents and evidence embeddings.

Normalized data is updated by idempotent jobs and should carry confidence/source metadata.

### Derived Features

Stored in Supabase:

- Daily medication exposures.
- Daily lifestyle snapshots.
- Rule evaluations.

Derived features can be rebuilt from source and normalized data. They should use upsert keys and deterministic windows.

### Generated Insights

Stored in Supabase:

- Correlation insight cards.
- AI run audit rows.
- User dismissals/feedback.

Generated insights are product artifacts. They should not mutate protocols, schedules, dose records, food entries, or Oura data.

### Processing Timing

Use these timing rules:

- **On write:** When user changes medication protocol, food, water, or dose status, enqueue a narrow refresh for affected dates.
- **On Oura sync:** After Oura daily pull completes, rebuild affected daily snapshots and queue insight refresh.
- **Nightly:** Run full refresh for active users over the last 90 days.
- **On demand:** User can manually refresh Insights; this should reuse existing snapshots where fresh and queue missing work.
- **On model/rule version change:** Re-run rule evaluation and insight review without re-pulling source data.

### Freshness Targets

- Medication map: within 1 minute of protocol edits.
- Food/water/dose-derived snapshot: within 1 minute of user action.
- Oura-derived snapshot: after Oura sync completes.
- Insight cards: immediate for manual refresh, otherwise nightly.
- Evidence refresh: weekly or on new medication/class discovery.

### Failure Handling

- Jobs must be idempotent by user, job type, date window, and source version.
- Failed jobs store `last_error` and `attempt_count`.
- AI failures should degrade to deterministic insight cards where possible.
- External evidence lookup failures should keep the previous curated/evidence cache.
- Unsafe medication wording fails closed and is not persisted.

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
7. AI review optionally improves structured explanations, but only after deterministic correlation and rule candidates exist.

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
9. AI model configuration via environment variables.
10. Structured Outputs schemas for classification, rule explanation, and insight review.
11. AI run audit table and validation pipeline.
12. Job table for idempotent sync/processing.
13. OpenRouter client wrapper for chat completions, model aliases, provider routing, strict structured outputs, and generation usage capture.

## Deferred Scope

Do not implement these in the first slice:

- Automatic parsing of arbitrary DailyMed labels into live rules.
- Full drug-drug interaction engine.
- Lab result ingestion and lab-aware medication recommendations.
- Dose titration guidance.
- Autonomous protocol changes.
- Direct medication stop/pause/reschedule recommendations.
- International drug terminology beyond RxNorm-backed matching.
- Fine-tuning custom models.
- Realtime voice coaching.
- Fully automated model-driven rule creation without human review.
- OpenRouter embedding/vector retrieval unless a specific embedding endpoint is selected later.

## Risks

- User-entered medication names can be ambiguous.
- Supplements may not normalize cleanly through RxNorm.
- Label text is not directly equivalent to personalized advice.
- Correlation is not causation, especially across 30-90 days.
- Medication-related wording can drift into unsafe advice if not constrained by typed recommendation kinds and tests.
- AI outputs can be plausible but wrong if not constrained by source-grounded schemas and deterministic validators.
- External model costs can spike if nightly jobs send large raw labels or raw user histories through OpenRouter.

## Success Criteria

- The app can read a user's active medication protocol and produce a normalized medication profile.
- GLP-1 and testosterone examples produce structured lifestyle implications.
- Daily medication exposure features can be joined with Oura, food, hydration, and adherence snapshots.
- Medication-change output is limited to clinician-review flags.
- Curated rule output is explainable and links back to evidence references.
- Custom/unknown drugs produce low-confidence profile entries rather than silent failure.
- AI model usage is explicit by pipeline, routed through OpenRouter, configurable by environment, and auditable through `ai_runs`.
- Sync jobs are idempotent and derived features can be rebuilt without modifying source records.

## Open Product Decisions

1. Whether the first UI should be hidden/debug-only or user-facing.
2. Whether medication analysis opt-in should live in Settings or in the Insights onboarding flow.
3. Whether RxNorm lookup should happen synchronously on medication creation or asynchronously in a background enrichment job.
4. Whether curated rules should ship as TypeScript constants first or as Supabase-managed rows from the beginning.
5. Whether evidence retrieval should remain lexical/model-reranked or add a dedicated embedding provider later.
6. Whether nightly processing should run from Vercel cron, external cron-job.org, or a Supabase scheduled job.
7. Whether AI-generated explanations should be shown immediately or require an internal review flag in early beta.
8. Whether `openrouter/auto` is allowed for any production pipeline, or only for development/non-critical fallback.

## Reference Notes

- OpenRouter API docs: use `POST https://openrouter.ai/api/v1/chat/completions` with OpenAI-compatible request/response shapes, app attribution headers, model routing, provider preferences, and usage reporting.
- OpenRouter Structured Outputs docs: compatible models can enforce JSON Schema through `response_format: { type: "json_schema" }`; set `require_parameters: true` when strict structured output support is required.
- OpenRouter model metadata should be checked before selecting a default model because supported model slugs and parameters change over time.
