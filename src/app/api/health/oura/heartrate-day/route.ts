import { NextRequest, NextResponse } from 'next/server';

import { createHealthServiceClient } from '@/lib/health/persistence';
import {
  classifyTagType,
  dayRangeUtc,
  downsampleHeartrate,
} from '@/lib/oura/heartrateDay';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

const HEARTRATE_ROW_LIMIT = 20_000;

type Row = Record<string, unknown>;

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();

  if (authError || !authData.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const date = request.nextUrl.searchParams.get('date');
  const tzOffsetRaw = request.nextUrl.searchParams.get('tzOffset');
  const tzOffset = tzOffsetRaw === null || tzOffsetRaw === '' ? 0 : Number(tzOffsetRaw);
  const range = dayRangeUtc(date, tzOffset);

  if (!range || !date) {
    return NextResponse.json({ error: 'Invalid date or tzOffset.' }, { status: 400 });
  }

  // This table is server-only under RLS, so the service-role read is explicitly
  // scoped to the authenticated user.
  const service = createHealthServiceClient();
  const { data: sampleRows, error: sampleError } = await service
    .from('oura_heartrate_samples')
    .select('ts, bpm')
    .eq('user_id', authData.user.id)
    .gte('ts', range.startIso)
    .lt('ts', range.endIso)
    .order('ts', { ascending: true })
    .limit(HEARTRATE_ROW_LIMIT);

  if (sampleError) {
    console.error('[health/oura/heartrate-day] samples query failed', sampleError);
    return NextResponse.json({ error: 'Pulse day unavailable.' }, { status: 500 });
  }

  const { data: tagRows, error: tagError } = await supabase
    .from('oura_tags')
    .select('tag_type, comment, start_time')
    .eq('local_date', date)
    .order('start_time', { ascending: true });

  if (tagError) {
    console.error('[health/oura/heartrate-day] tags query failed', tagError);
    return NextResponse.json({ error: 'Pulse day unavailable.' }, { status: 500 });
  }

  const { data: doseRows, error: doseError } = await supabase
    .from('execution_events')
    .select('event_at, protocol_items(name)')
    .eq('event_type', 'taken')
    .gte('event_at', range.startIso)
    .lt('event_at', range.endIso)
    .order('event_at', { ascending: true });

  if (doseError) {
    console.error('[health/oura/heartrate-day] doses query failed', doseError);
    return NextResponse.json({ error: 'Pulse day unavailable.' }, { status: 500 });
  }

  const points = downsampleHeartrate(sampleRows ?? []);

  const tags = (tagRows ?? []).flatMap((raw) => {
    const row = raw as Row;
    const ts = stringOrNull(row.start_time);
    if (!ts) return [];
    return [{
      ts,
      kind: classifyTagType(row.tag_type),
      tagType: stringOrNull(row.tag_type),
      comment: stringOrNull(row.comment),
    }];
  });

  const doses = (doseRows ?? []).flatMap((raw) => {
    const row = raw as Row;
    const ts = stringOrNull(row.event_at);
    if (!ts) return [];
    const item = row.protocol_items as { name?: unknown } | Array<{ name?: unknown }> | null;
    const name = Array.isArray(item) ? item[0]?.name : item?.name;
    return [{ ts, label: typeof name === 'string' && name.length > 0 ? name : 'Dose' }];
  });

  return NextResponse.json({
    date,
    startIso: range.startIso,
    endIso: range.endIso,
    points,
    tags,
    doses,
  });
}
