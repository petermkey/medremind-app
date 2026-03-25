import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/execute-lifecycle-cleanup.mjs');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function runCleanup() {
  console.log('🔄 Starting Lifecycle Timestamp Cleanup (D5)...');

  // 1. Protocols in 'active' status must have NULL paused_at and completed_at
  console.log('--- Cleaning "active" protocols ---');
  const { data: activeUpdated, error: activeErr } = await supabase
    .from('active_protocols')
    .update({ paused_at: null, completed_at: null })
    .eq('status', 'active')
    .or('paused_at.not.is.null,completed_at.not.is.null')
    .select('id');

  if (activeErr) console.error('Error cleaning active protocols:', activeErr);
  else console.log(`✅ Cleared ${activeUpdated?.length || 0} active protocols.`);

  // 2. Protocols in 'paused' status must have NULL completed_at
  console.log('--- Cleaning "paused" protocols ---');
  const { data: pausedUpdated, error: pausedErr } = await supabase
    .from('active_protocols')
    .update({ completed_at: null })
    .eq('status', 'paused')
    .not('completed_at', 'is', null)
    .select('id');

  if (pausedErr) console.error('Error cleaning paused protocols:', pausedErr);
  else console.log(`✅ Cleared ${pausedUpdated?.length || 0} paused protocols.`);

  // 3. Protocols in terminal status ('completed', 'abandoned') should have NULL paused_at
  console.log('--- Cleaning terminal protocols ---');
  const { data: terminalUpdated, error: terminalErr } = await supabase
    .from('active_protocols')
    .update({ paused_at: null })
    .in('status', ['completed', 'abandoned'])
    .not('paused_at', 'is', null)
    .select('id');

  if (terminalErr) console.error('Error cleaning terminal protocols:', terminalErr);
  else console.log(`✅ Cleared ${terminalUpdated?.length || 0} terminal protocols.`);

  console.log('🎉 Cleanup finished.');
}

runCleanup();
