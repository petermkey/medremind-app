import { type NextRequest, NextResponse } from 'next/server';

// Sentry tunnel route — forwards envelopes to Sentry while bypassing ad-blockers.
// Validates host + project ID so this can't be abused as an open proxy.
const SENTRY_HOST = 'o4511540705820672.ingest.us.sentry.io';
const SENTRY_PROJECT_IDS = ['4511540728365056'];

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const envelope = await request.text();
    const header = JSON.parse(envelope.split('\n')[0]) as { dsn?: string };
    if (!header.dsn) {
      return NextResponse.json({ error: 'missing dsn' }, { status: 400 });
    }

    const dsn = new URL(header.dsn);
    if (dsn.hostname !== SENTRY_HOST) {
      return NextResponse.json({ error: 'invalid host' }, { status: 403 });
    }

    const projectId = dsn.pathname.replace(/^\//, '');
    if (!SENTRY_PROJECT_IDS.includes(projectId)) {
      return NextResponse.json({ error: 'invalid project' }, { status: 403 });
    }

    const sentryUrl = `https://${SENTRY_HOST}/api/${projectId}/envelope/`;
    const upstream = await fetch(sentryUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-sentry-envelope' },
      body: envelope,
    });

    return new NextResponse(null, { status: upstream.status });
  } catch {
    return NextResponse.json({ error: 'tunnel error' }, { status: 500 });
  }
}
