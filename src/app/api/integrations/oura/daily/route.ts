import { NextRequest, NextResponse } from 'next/server';

import { fetchOuraJson, refreshOuraAccessToken } from '@/lib/oura/client';
import { getOuraServerConfig } from '@/lib/oura/config';
import {
  getStoredOuraTokens,
  markOuraSyncSuccess,
  updateStoredOuraTokens,
} from '@/lib/oura/tokenStore';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function toDateInput(value: string | null): string | null {
  if (!value) return null;
  return DATE_RE.test(value) ? value : null;
}

function defaultStartDate() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - 14);
  return date.toISOString().slice(0, 10);
}

function defaultEndDate() {
  return new Date().toISOString().slice(0, 10);
}

function tokenExpiresSoon(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  return Date.parse(expiresAt) - Date.now() < 60_000;
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startDate = toDateInput(request.nextUrl.searchParams.get('start_date')) ?? defaultStartDate();
  const endDate = toDateInput(request.nextUrl.searchParams.get('end_date')) ?? defaultEndDate();

  if (startDate > endDate) {
    return NextResponse.json({ error: 'start_date must be before or equal to end_date.' }, { status: 400 });
  }

  try {
    const config = getOuraServerConfig();
    let tokens = await getStoredOuraTokens(data.user.id, config.tokenEncryptionKey);

    if (!tokens) {
      return NextResponse.json({ error: 'Oura is not connected.' }, { status: 404 });
    }

    if (tokenExpiresSoon(tokens.expiresAt)) {
      if (!tokens.refreshToken) {
        return NextResponse.json({ error: 'Oura refresh token is unavailable.' }, { status: 409 });
      }

      const refreshed = await refreshOuraAccessToken({
        tokenUrl: config.tokenUrl,
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        refreshToken: tokens.refreshToken,
      });

      await updateStoredOuraTokens({
        rowId: tokens.rowId,
        tokenSet: refreshed,
        existingScopes: tokens.scopes,
        encryptionKey: config.tokenEncryptionKey,
      });

      tokens = await getStoredOuraTokens(data.user.id, config.tokenEncryptionKey);
      if (!tokens) {
        return NextResponse.json({ error: 'Oura token refresh failed.' }, { status: 502 });
      }
    }

    const range = { start_date: startDate, end_date: endDate };
    const [dailySleep, readiness, activity, spo2, stress] = await Promise.all([
      fetchOuraJson(config.apiBaseUrl, tokens.accessToken, '/v2/usercollection/daily_sleep', range),
      fetchOuraJson(config.apiBaseUrl, tokens.accessToken, '/v2/usercollection/daily_readiness', range),
      fetchOuraJson(config.apiBaseUrl, tokens.accessToken, '/v2/usercollection/daily_activity', range),
      fetchOuraJson(config.apiBaseUrl, tokens.accessToken, '/v2/usercollection/daily_spo2', range),
      fetchOuraJson(config.apiBaseUrl, tokens.accessToken, '/v2/usercollection/daily_stress', range),
    ]);

    await markOuraSyncSuccess(data.user.id);

    return NextResponse.json({
      range,
      providerUserId: tokens.providerUserId,
      dailySleep,
      readiness,
      activity,
      spo2,
      stress,
    });
  } catch (err) {
    console.error('[oura/daily] fetch failed', err);
    return NextResponse.json({ error: 'Oura data fetch failed.' }, { status: 502 });
  }
}
