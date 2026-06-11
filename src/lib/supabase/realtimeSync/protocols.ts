'use client';

import type { Protocol } from '@/types';
import { getSupabaseClient } from '../client';
import {
  chunk,
  cloudActiveId,
  cloudProtocolId,
  cloudProtocolItemId,
  upsertProtocolWithItems,
} from './helpers';

export async function syncProtocolUpsert(userId: string, protocol: Protocol): Promise<void> {
  await upsertProtocolWithItems(userId, protocol);
}

export async function syncProtocolItemDelete(
  userId: string,
  protocolId: string,
  itemId: string,
): Promise<void> {
  const supabase = getSupabaseClient();
  const id = cloudProtocolItemId(userId, protocolId, itemId);
  // Cascade on protocol_items → planned_occurrences handles occurrence cleanup.
  const { error } = await supabase.from('protocol_items').delete().eq('id', id);
  if (error) throw new Error(`Delete protocol item failed: ${error.message}`);
}

export async function syncProtocolDelete(userId: string, protocolId: string): Promise<void> {
  const supabase = getSupabaseClient();
  const cProtocolId = cloudProtocolId(userId, protocolId);

  const { data: activeRows, error: activeErr } = await supabase
    .from('active_protocols')
    .select('id')
    .eq('user_id', userId)
    .eq('protocol_id', cProtocolId);
  if (activeErr) throw new Error(`Load active protocols for delete failed: ${activeErr.message}`);

  const activeIds = ((activeRows ?? []) as Array<{ id: string }>).map(row => row.id);
  if (activeIds.length) {
    // Delete active_protocols — cascade handles planned_occurrences.
    for (const ids of chunk(activeIds, 250)) {
      const { error: aErr } = await supabase
        .from('active_protocols')
        .delete()
        .eq('user_id', userId)
        .in('id', ids);
      if (aErr) throw new Error(`Delete active protocols failed: ${aErr.message}`);
    }
  }

  const { error: pErr } = await supabase
    .from('protocols')
    .delete()
    .eq('owner_id', userId)
    .eq('id', cProtocolId);
  if (pErr) throw new Error(`Delete protocol failed: ${pErr.message}`);
}
