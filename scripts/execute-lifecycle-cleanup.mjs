#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';

function parseArgs(argv) {
  const parsed = {
    apply: false,
    userId: null,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--apply') {
      parsed.apply = true;
      continue;
    }
    if (token === '--dry-run') {
      parsed.apply = false;
      continue;
    }
    if (token === '--user-id') {
      parsed.userId = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (token === '--help' || token === '-h') {
      parsed.help = true;
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  return parsed;
}

function printHelp() {
  console.log(`Lifecycle timestamp cleanup (D5)\n\nUsage:\n  node scripts/execute-lifecycle-cleanup.mjs [--dry-run] [--apply] [--user-id <uuid>]\n\nModes:\n  --dry-run  (default) report affected active_protocols rows; no writes\n  --apply    update lifecycle timestamp invariants\n\nOptions:\n  --user-id <uuid>  Limit cleanup to one user scope\n  --help, -h        Show this message\n\nEnvironment:\n  SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL\n  SUPABASE_SERVICE_ROLE_KEY`);
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  printHelp();
  process.exit(0);
}

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  printHelp();
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

function applyUserScope(query) {
  return args.userId ? query.eq('user_id', args.userId) : query;
}

const steps = [
  {
    label: 'active protocols with paused_at/completed_at',
    patch: { paused_at: null, completed_at: null },
    filter: query => applyUserScope(query.eq('status', 'active').or('paused_at.not.is.null,completed_at.not.is.null')),
  },
  {
    label: 'paused protocols with completed_at',
    patch: { completed_at: null },
    filter: query => applyUserScope(query.eq('status', 'paused').not('completed_at', 'is', null)),
  },
  {
    label: 'terminal protocols with paused_at',
    patch: { paused_at: null },
    filter: query => applyUserScope(query.in('status', ['completed', 'abandoned']).not('paused_at', 'is', null)),
  },
];

async function countAffectedRows(step) {
  const { count, error } = await step.filter(
    supabase.from('active_protocols').select('id', { count: 'exact', head: true }),
  );
  if (error) throw new Error(`${step.label} dry-run failed: ${error.message}`);
  return count ?? 0;
}

async function updateRows(step) {
  const { data, error } = await step.filter(
    supabase.from('active_protocols').update(step.patch),
  ).select('id');
  if (error) throw new Error(`${step.label} update failed: ${error.message}`);
  return data?.length ?? 0;
}

async function runCleanup() {
  const mode = args.apply ? 'APPLY' : 'DRY-RUN';
  console.log(`Lifecycle timestamp cleanup (D5) mode=${mode}${args.userId ? ` userId=${args.userId}` : ''}`);

  let total = 0;
  for (const step of steps) {
    const count = args.apply ? await updateRows(step) : await countAffectedRows(step);
    total += count;
    console.log(`${args.apply ? 'updated' : 'wouldUpdate'} ${count} ${step.label}`);
  }

  console.log(`${args.apply ? 'Updated' : 'Would update'} ${total} total rows.`);
  if (!args.apply) {
    console.log('Dry run only. Re-run with --apply to mutate data.');
  }
}

runCleanup().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
