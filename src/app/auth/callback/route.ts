import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// OAuth PKCE callback — exchanges the one-time code for a session.
// Supabase redirects here after the provider (Google / Apple) authenticates the user.
// The code is only valid once and must be exchanged server-side.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error && data.user) {
      // Determine whether the user still needs to complete onboarding.
      // The DB trigger guarantees a profiles row exists at this point.
      const { data: profile } = await supabase
        .from('profiles')
        .select('onboarded')
        .eq('id', data.user.id)
        .maybeSingle();

      const destination = profile?.onboarded ? '/app' : '/onboarding';
      return NextResponse.redirect(`${origin}${destination}`);
    }
  }

  // Code missing or exchange failed — send back to login with a readable flag.
  return NextResponse.redirect(`${origin}/login?error=oauth`);
}
