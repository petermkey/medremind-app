-- 031: WS1 ledger reaper — partial index on sync_operations(updated_at) for
-- rows still 'inflight', so the reaper's stale-lookup scan doesn't do a full
-- table scan. Owner-applies only — not run by this task.
create index if not exists idx_sync_operations_inflight on sync_operations (updated_at) where status = 'inflight';
