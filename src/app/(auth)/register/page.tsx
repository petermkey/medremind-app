'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useStore } from '@/lib/store/store';
import { resendSignupConfirmationEmail, signInWithOAuth, supabaseSignUp } from '@/lib/supabase/auth';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

function validate(name: string, email: string, password: string, confirm: string) {
  if (!name.trim()) return 'Name is required.';
  if (!email.includes('@')) return 'Enter a valid email address.';
  if (password.length < 8) return 'Password must be at least 8 characters.';
  if (!/\d/.test(password)) return 'Password must contain at least one number.';
  if (password !== confirm) return 'Passwords do not match.';
  return null;
}

export default function RegisterPage() {
  const RESEND_COOLDOWN_SECONDS = 30;
  const router = useRouter();
  const store = useStore();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [confirmationPending, setConfirmationPending] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [resendMessage, setResendMessage] = useState('');
  const [resendError, setResendError] = useState(false);
  const [resendCooldownLeft, setResendCooldownLeft] = useState(0);
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState<'google' | null>(null);
  const [oauthError, setOauthError] = useState('');

  useEffect(() => {
    if (resendCooldownLeft <= 0) return;
    const timer = setInterval(() => {
      setResendCooldownLeft(prev => Math.max(prev - 1, 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldownLeft]);

  async function handleOAuth(provider: 'google') {
    setOauthLoading(provider);
    setOauthError('');
    const err = await signInWithOAuth(provider);
    if (err) {
      setOauthError(err);
      setOauthLoading(null);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setInfo('');
    setConfirmationPending(false);
    setResendMessage('');
    setResendError(false);
    const err = validate(name, email, password, confirm);
    if (err) { setError(err); return; }
    if (!agreed) { setError('Please accept the terms to continue.'); return; }

    setLoading(true);
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const { profile, error: authError, hasSession } = await supabaseSignUp(email, password, name.trim(), timezone);
    setLoading(false);

    if (authError || !profile) {
      setError(authError ?? 'Registration failed. Please try again.');
      return;
    }

    if (!hasSession) {
      setInfo('Account created. Please check your email and confirm your account, then sign in.');
      setConfirmationPending(true);
      setPassword('');
      setConfirm('');
      return;
    }

    store.resetUserData();
    store.setProfile(profile);
    router.push('/onboarding');
  }

  async function handleResendConfirmation() {
    if (resendCooldownLeft > 0) return;
    if (!email.trim()) {
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
        <h1 className="text-2xl font-extrabold text-[#F0F6FC] mb-2">Create your account</h1>
        <p className="text-sm text-[#8B949E] mb-8">Free to use. No subscription required.</p>

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

          {oauthError && <p className="text-sm text-[#EF4444] bg-[rgba(239,68,68,0.1)] px-4 py-3 rounded-xl">{oauthError}</p>}
        </div>

        <div className="flex items-center gap-3 mb-2">
          <div className="flex-1 h-px bg-[#30363D]" />
          <span className="text-xs text-[#8B949E]">or sign up with email</span>
          <div className="flex-1 h-px bg-[#30363D]" />
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Input label="Full name" type="text" placeholder="Peter" value={name} onChange={e => setName(e.target.value)} autoComplete="name" />
          <Input label="Email" type="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" />
          <Input label="Password" type="password" placeholder="Min 8 chars, 1 number" value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" />
          <Input label="Confirm password" type="password" placeholder="Repeat password" value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="new-password" />
          <label className="flex items-start gap-3 cursor-pointer mt-1">
            <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} className="mt-0.5 w-4 h-4 accent-[#3B82F6]" />
            <span className="text-xs text-[#8B949E] leading-relaxed">
              I agree to the <a href="#" className="text-[#3B82F6]">Terms of Service</a> and <a href="#" className="text-[#3B82F6]">Privacy Policy</a>. This app does not provide medical advice.
            </span>
          </label>
          {error && <p className="text-sm text-[#EF4444] bg-[rgba(239,68,68,0.1)] px-4 py-3 rounded-xl">{error}</p>}
          {info && (
            <div className="text-sm bg-[rgba(59,130,246,0.1)] border border-[rgba(59,130,246,0.3)] text-[#C9D1D9] px-4 py-3 rounded-xl">
              <p>{info}</p>
              {confirmationPending && (
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
              )}
              {resendMessage && (
                <p className={`text-xs mt-2 ${resendError ? 'text-[#EF4444]' : 'text-[#8B949E]'}`}>{resendMessage}</p>
              )}
              <button type="button" onClick={() => router.push('/login')} className="mt-2 text-xs font-semibold text-[#3B82F6] hover:underline">
                Go to sign in
              </button>
            </div>
          )}
          <Button type="submit" size="lg" fullWidth loading={loading} className="mt-2">Create account</Button>
        </form>
        <p className="text-center text-sm text-[#8B949E] mt-6">
          Already have an account?{' '}
          <Link href="/login" className="text-[#3B82F6] font-semibold hover:underline">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
