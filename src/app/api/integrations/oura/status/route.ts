import { NextResponse } from 'next/server';

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
    return NextResponse.json(status);
  } catch (err) {
    console.error('[oura/status] fetch failed', err);
    return NextResponse.json({ error: 'Oura status unavailable.' }, { status: 500 });
  }
}
