import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const sha =
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ||
    process.env.GIT_COMMIT_SHA ||
    'unknown';

  const environment =
    process.env.VERCEL_ENV ||
    process.env.NODE_ENV ||
    'unknown';

  return NextResponse.json({
    sha,
    environment,
    timestamp: new Date().toISOString(),
  });
}
