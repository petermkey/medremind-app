-- WS8 remediation: retire the inert medication-knowledge enrichment layer.
-- All 7 tables below were written only by the now-deleted
-- POST /api/medication-knowledge/refresh route; medication_rule_evaluations,
-- medication_evidence_documents, and medication_ai_runs were empty at 0 rows
-- (medication_ai_runs: 0 rows ever), daily_medication_exposures frozen since
-- April. See docs/superpowers/plans/2026-08-08-rem-ws8-medknowledge-retire.md.
--
-- APPLY THIS AFTER the WS8 PR has merged and deployed to production, not
-- before — src/lib/correlation/persistence.ts stopped querying
-- daily_medication_exposures in that PR's Task 1; applying this migration
-- before that code is live would break the correlation-refresh cron.

drop table if exists medication_normalizations cascade;
drop table if exists medication_rule_evaluations cascade;
drop table if exists medication_evidence_documents cascade;
drop table if exists medication_ai_runs cascade;
drop table if exists daily_medication_exposures cascade;
drop table if exists medication_processing_jobs cascade;
drop table if exists medication_map_items cascade;
