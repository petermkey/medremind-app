// W3-A Stack Guard — on-demand evaluation (owner decision: no persistence, no
// migration 028). Auth-gated GET; computes from active protocols + cached
// supplement_nutrient_facts (026, W2-C); degrades to name-based rules when
// facts are missing or the table is not applied yet.
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

import { evaluateStack, type StackItemInput, type SupplementFactsInput } from '@/lib/stackGuard/engine';
import { STACK_GUARD_RULES } from '@/lib/stackGuard/rules';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

type Row = Record<string, unknown>;

function serviceClient() {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Supabase service role environment is required.');
  }
  return createServiceClient(supabaseUrl, serviceRoleKey);
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function toStackItem(row: Row): StackItemInput {
  return {
    protocolItemId: String(row.id),
    name: typeof row.name === 'string' ? row.name : '',
    times: Array.isArray(row.times) ? row.times.map(String) : [],
    withFood: typeof row.with_food === 'string' ? row.with_food : null,
    doseAmount: toNumber(row.dose_amount),
    doseUnit: typeof row.dose_unit === 'string' ? row.dose_unit : null,
  };
}

function toFacts(row: Row): SupplementFactsInput | null {
  if (typeof row.normalized_name !== 'string') return null;
  return {
    normalizedName: row.normalized_name,
    doseAmount: toNumber(row.dose_amount) ?? 0,
    doseUnit: typeof row.dose_unit === 'string' ? row.dose_unit : '',
    nutrients: (row.nutrients && typeof row.nutrients === 'object' ? row.nutrients : {}) as Record<string, unknown>,
    validationStatus: typeof row.validation_status === 'string' ? row.validation_status : 'pending',
  };
}

export async function GET() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const service = serviceClient();
  const userId = data.user.id;

  const activeResult = await service
    .from('active_protocols')
    .select('id, protocol_id')
    .eq('user_id', userId)
    .eq('status', 'active');
  if (activeResult.error) {
    return NextResponse.json({ error: 'Failed to load active protocols.' }, { status: 500 });
  }

  const protocolIds = [...new Set((activeResult.data ?? []).map((row) => row.protocol_id))];
  if (protocolIds.length === 0) {
    return NextResponse.json(evaluateStack([], [], STACK_GUARD_RULES));
  }

  const itemsResult = await service
    .from('protocol_items')
    .select('id, protocol_id, item_type, name, times, with_food, dose_amount, dose_unit')
    .in('protocol_id', protocolIds);
  if (itemsResult.error) {
    return NextResponse.json({ error: 'Failed to load protocol items.' }, { status: 500 });
  }

  const stackItems = ((itemsResult.data as Row[] | null) ?? [])
    .filter((row) => row.item_type === 'medication')
    .map(toStackItem);

  const factsResult = await service
    .from('supplement_nutrient_facts')
    .select('normalized_name, dose_amount, dose_unit, nutrients, validation_status')
    .limit(500);
  const facts = factsResult.error
    ? []
    : ((factsResult.data as Row[] | null) ?? []).map(toFacts).filter((fact): fact is SupplementFactsInput => fact !== null);

  return NextResponse.json(evaluateStack(stackItems, facts, STACK_GUARD_RULES));
}
