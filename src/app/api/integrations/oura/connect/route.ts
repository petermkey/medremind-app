import { randomBytes } from 'node:crypto';

import { NextRequest, NextResponse } from 'next/server';

import { getOuraServerConfig } from '@/lib/oura/config';
import { buildOuraAuthorizationUrl } from '@/lib/oura/oauth';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

const STATE_COOKIE = 'oura_oauth_state';

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let config;
  try {
    config = getOuraServerConfig();
  } catch {
    return NextResponse.json({ error: 'Oura integration is not configured.' }, { status: 500 });
  }

  const state = randomBytes(32).toString('base64url');
  const authorizationUrl = buildOuraAuthorizationUrl({
    authorizationUrl: config.authorizationUrl,
    clientId: config.clientId,
    redirectUri: config.redirectUri,
    scopes: config.scopes,
    state,
  });

  const response = NextResponse.redirect(authorizationUrl);
  response.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: request.nextUrl.protocol === 'https:',
    path: '/api/integrations/oura',
    maxAge: 10 * 60,
  });

  return response;
}
