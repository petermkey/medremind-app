import { NextResponse } from 'next/server';

import { getOuraServerConfig } from '@/lib/oura/config';
import { normalizeOuraScope } from '@/lib/oura/oauth';
import { getOuraIntegrationStatus } from '@/lib/oura/tokenStore';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

export async function GET() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const status = await getOuraIntegrationStatus(data.user.id);
    const { data: connectionRow } = await supabase
      .from('external_health_connections')
      .select('battery_level, battery_charging, battery_at, sleep_window_date')
      .eq('user_id', data.user.id)
      .eq('source', 'oura')
      .maybeSingle();

    // Oura tokens don't retroactively gain scopes when the app's required set
    // changes — surface a drift so the client can prompt a reconnect instead
    // of silently 401ing on the endpoints that need the missing scope.
    let missingScopes: string[] = [];
    if (status.connected) {
      try {
        const requiredScopes = getOuraServerConfig().scopes;
        const grantedScopes = new Set(status.scopes.map(normalizeOuraScope));
        missingScopes = requiredScopes.filter((scope) => !grantedScopes.has(scope));
      } catch (configErr) {
        console.error('[oura/status] scope-drift check skipped', configErr);
      }
    }

    return NextResponse.json({
      ...status,
      missingScopes,
      battery: connectionRow?.battery_level != null
        ? {
            level: connectionRow.battery_level,
            charging: connectionRow.battery_charging === true,
            at: connectionRow.battery_at,
          }
        : null,
      sleepWindowDate: connectionRow?.sleep_window_date ?? null,
    });
  } catch (err) {
    console.error('[oura/status] fetch failed', err);
    return NextResponse.json({ error: 'Oura status unavailable.' }, { status: 500 });
  }
}
