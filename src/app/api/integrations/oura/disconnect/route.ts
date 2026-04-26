import { createClient as createServiceClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

function serviceClient() {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Supabase service role environment is required for Oura integration storage.');
  }

  return createServiceClient(supabaseUrl, serviceRoleKey);
}

export async function POST() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const service = serviceClient();
    const { error: updateError } = await service
      .from('user_integrations')
      .update({
        access_token_ciphertext: '',
        refresh_token_ciphertext: null,
        expires_at: null,
        scopes: [],
        status: 'revoked',
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', data.user.id)
      .eq('provider', 'oura');

    if (updateError) throw updateError;

    return NextResponse.json({
      connected: false,
      status: 'revoked',
      lastSyncAt: null,
    });
  } catch (err) {
    console.error('[oura/disconnect] failed', err);
    return NextResponse.json({ error: 'Oura disconnect failed.' }, { status: 500 });
  }
}
