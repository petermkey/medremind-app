'use client';
import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useFoodStore } from '@/lib/store/foodStore';
import { useStore } from '@/lib/store/store';
import { isEmailConfirmationRequiredError, resendSignupConfirmationEmail, signInWithOAuth, supabaseSignIn } from '@/lib/supabase/auth';
import { pullStoreFromSupabase } from '@/lib/supabase/cloudStore';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

function LoginForm() {
  const RESEND_COOLDOWN_SECONDS = 30;
  const router = useRouter();
  const searchParams = useSearchParams();
  const store = useStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(searchParams.get('error') === 'oauth' ? 'Sign-in failed. Please try again.' : '');
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState<'google' | null>(null);
  const [emailUnconfirmed, setEmailUnconfirmed] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [resendMessage, setResendMessage] = useState('');
  const [resendError, setResendError] = useState(false);
  const [resendCooldownLeft, setResendCooldownLeft] = useState(0);

  useEffect(() => {
    if (resendCooldownLeft <= 0) return;
    const timer = setInterval(() => {
      setResendCooldownLeft(prev => Math.max(prev - 1, 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldownLeft]);

  async function handleOAuth(provider: 'google') {
    setOauthLoading(provider);
    const err = await signInWithOAuth(provider);
    if (err) {
      setError(err);
      setOauthLoading(null);
    }
    // On success the browser navigates away; no need to reset state.
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setEmailUnconfirmed(false);
    setResendMessage('');
    setResendError(false);
    if (!email || !password) { setError('Please fill in all fields.'); return; }
    setLoading(true);
    const { profile, error: authError } = await supabaseSignIn(email, password);
    setLoading(false);
    if (authError || !profile) {
      const message = authError ?? 'Sign-in failed. Check your credentials.';
      const isUnconfirmed = isEmailConfirmationRequiredError(message);
      if (isUnconfirmed) {
        setEmailUnconfirmed(true);
        setError('');
      } else {
        setError(message);
      }
      return;
    }
    store.resetUserData();
    useFoodStore.getState().resetFoodEntries();
    store.setProfile(profile);
    try {
      await pullStoreFromSupabase();
    } catch (error) {
      console.error('[cloud-pull-after-login-failed]', error);
    }
    router.push(profile.onboarded ? '/app' : '/onboarding');
  }

  async function handleResendConfirmation() {
    if (resendCooldownLeft > 0) return;
    if (!email) {
      setResendMessage('Enter your email first.');
      setResendError(true);
      return;
    }
    setResendLoading(true);
    setResendMessage('');
    setResendError(false);
    setResendCooldownLeft(RESEND_COOLDOWN_SECONDS);
    const resendError = await resendSignupConfirmationEmail(email.trim());
    setResendLoading(false);
    if (resendError) {
      setResendMessage(resendError);
      setResendError(true);
      return;
    }
    setResendMessage('Confirmation email sent. Please check your inbox.');
  }

  return (
    <div className="min-h-screen bg-[#0D1117] flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-3 justify-center mb-10">
          <div className="w-10 h-10 rounded-xl bg-[#3B82F6] flex items-center justify-center text-xl">💊</div>
          <span className="text-xl font-bold text-[#F0F6FC]">MedRemind</span>
        </div>
        <h1 className="text-2xl font-extrabold text-[#F0F6FC] mb-2">Welcome back</h1>
        <p className="text-sm text-[#8B949E] mb-8">Sign in to your account</p>

        {/* OAuth providers */}
        <div className="flex flex-col gap-3 mb-6">
          <button
            type="button"
            onClick={() => handleOAuth('google')}
            disabled={oauthLoading !== null}
            className="flex items-center justify-center gap-3 w-full px-4 py-3 rounded-xl border border-[#30363D] bg-[#161B22] text-[#C9D1D9] text-sm font-medium hover:bg-[#1C2128] disabled:opacity-60 transition-colors"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
              <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" fill="#4285F4"/>
              <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
              <path d="M3.964 10.707A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.707V4.961H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.039l3.007-2.332z" fill="#FBBC05"/>
              <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.961L3.964 7.293C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
            </svg>
            {oauthLoading === 'google' ? 'Redirecting…' : 'Continue with Google'}
          </button>

        </div>

        <div className="flex items-center gap-3 mb-2">
          <div className="flex-1 h-px bg-[#30363D]" />
          <span className="text-xs text-[#8B949E]">or sign in with email</span>
          <div className="flex-1 h-px bg-[#30363D]" />
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <Input label="Email" type="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" />
          <Input label="Password" type="password" placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" />
          {error && <p className="text-sm text-[#EF4444] bg-[rgba(239,68,68,0.1)] px-4 py-3 rounded-xl">{error}</p>}
          {emailUnconfirmed && (
            <div className="text-sm bg-[rgba(251,191,36,0.1)] border border-[rgba(251,191,36,0.3)] text-[#FBBF24] px-4 py-3 rounded-xl">
              <p className="font-semibold">Email confirmation required.</p>
              <p className="text-xs text-[#8B949E] mt-1">Please confirm your email from your inbox before signing in.</p>
              <button
                type="button"
                onClick={handleResendConfirmation}
                disabled={resendLoading || resendCooldownLeft > 0}
                className="mt-2 text-xs font-semibold text-[#3B82F6] hover:underline disabled:opacity-60"
              >
                {resendLoading
                  ? 'Sending…'
                  : resendCooldownLeft > 0
                  ? `Resend available in ${resendCooldownLeft}s`
                  : 'Resend confirmation email'}
              </button>
              {resendMessage && (
                <p className={`text-xs mt-2 ${resendError ? 'text-[#EF4444]' : 'text-[#8B949E]'}`}>{resendMessage}</p>
              )}
            </div>
          )}
          <Button type="submit" size="lg" fullWidth loading={loading}>Sign in</Button>
        </form>
        <p className="text-center text-sm text-[#8B949E] mt-6">
          No account?{' '}
          <Link href="/register" className="text-[#3B82F6] font-semibold hover:underline">Create one free</Link>
        </p>
        <p className="text-center text-xs text-[#8B949E] mt-8 leading-relaxed">
          MedRemind is not a substitute for medical advice.<br />Always consult your healthcare provider.
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#0D1117] flex items-center justify-center"><div className="w-8 h-8 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" /></div>}>
      <LoginForm />
    </Suspense>
  );
}
