import { NextRequest, NextResponse } from 'next/server';

import { exchangeOuraAuthorizationCode } from '@/lib/oura/client';
import { getOuraServerConfig } from '@/lib/oura/config';
import { fetchOuraPersonalInfo, saveOuraConnection } from '@/lib/oura/tokenStore';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

const STATE_COOKIE = 'oura_oauth_state';

function redirectToSettings(request: NextRequest, status: 'connected' | 'error') {
  return new URL(`/app/settings?oura=${status}`, request.nextUrl.origin);
}

export async function GET(request: NextRequest) {
  const errorCode = request.nextUrl.searchParams.get('error');
  const code = request.nextUrl.searchParams.get('code');
  const state = request.nextUrl.searchParams.get('state');
  const expectedState = request.cookies.get(STATE_COOKIE)?.value;

  if (errorCode || !code || !state || !expectedState || state !== expectedState) {
    const response = NextResponse.redirect(redirectToSettings(request, 'error'));
    response.cookies.delete(STATE_COOKIE);
    return response;
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    const response = NextResponse.redirect(new URL('/login?error=oauth', request.nextUrl.origin));
    response.cookies.delete(STATE_COOKIE);
    return response;
  }

  try {
    const config = getOuraServerConfig();
    const tokenSet = await exchangeOuraAuthorizationCode({
      tokenUrl: config.tokenUrl,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      code,
      redirectUri: config.redirectUri,
    });

    const personalInfo = await fetchOuraPersonalInfo(config.apiBaseUrl, tokenSet.accessToken);

    await saveOuraConnection({
      userId: data.user.id,
      tokenSet,
      personalInfo,
      fallbackScopes: config.scopes,
      encryptionKey: config.tokenEncryptionKey,
    });

    const response = NextResponse.redirect(redirectToSettings(request, 'connected'));
    response.cookies.delete(STATE_COOKIE);
    return response;
  } catch (err) {
    console.error('[oura/callback] connection failed', err);
    const response = NextResponse.redirect(redirectToSettings(request, 'error'));
    response.cookies.delete(STATE_COOKIE);
    return response;
  }
}
