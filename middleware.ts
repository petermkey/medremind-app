import { proxy } from '@/proxy';
import type { NextRequest } from 'next/server';

// Delegates to proxy(), which:
// 1. Refreshes the Supabase session (required for OAuth PKCE callback)
// 2. Protects /app/* — redirects unauthenticated users to /login
// 3. Redirects authenticated users away from /login and /register
export async function middleware(request: NextRequest) {
  return proxy(request);
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|manifest.json|icon-.*\\.png).*)',
  ],
};
