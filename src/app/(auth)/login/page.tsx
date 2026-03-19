'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useStore } from '@/lib/store/store';
import { resendSignupConfirmationEmail, supabaseSignIn } from '@/lib/supabase/auth';
import { pullStoreFromSupabase } from '@/lib/supabase/cloudStore';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

export default function LoginPage() {
  const router = useRouter();
  const store = useStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [emailUnconfirmed, setEmailUnconfirmed] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [resendMessage, setResendMessage] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setEmailUnconfirmed(false);
    setResendMessage('');
    if (!email || !password) { setError('Please fill in all fields.'); return; }
    setLoading(true);
    const { profile, error: authError } = await supabaseSignIn(email, password);
    setLoading(false);
    if (authError || !profile) {
      const message = authError ?? 'Sign-in failed. Check your credentials.';
      const isUnconfirmed = /email[^.]*not[^.]*confirmed/i.test(message) || /email_not_confirmed/i.test(message);
      if (isUnconfirmed) {
        setEmailUnconfirmed(true);
        setError('');
      } else {
        setError(message);
      }
      return;
    }
    store.resetUserData();
    store.setProfile(profile);
    try {
      await pullStoreFromSupabase();
    } catch (error) {
      console.error('[cloud-pull-after-login-failed]', error);
    }
    router.push(profile.onboarded ? '/app' : '/onboarding');
  }

  async function handleResendConfirmation() {
    if (!email) {
      setResendMessage('Enter your email first.');
      return;
    }
    setResendLoading(true);
    setResendMessage('');
    const resendError = await resendSignupConfirmationEmail(email.trim());
    setResendLoading(false);
    if (resendError) {
      setResendMessage(resendError);
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
                disabled={resendLoading}
                className="mt-2 text-xs font-semibold text-[#3B82F6] hover:underline disabled:opacity-60"
              >
                {resendLoading ? 'Sending…' : 'Resend confirmation email'}
              </button>
              {resendMessage && (
                <p className="text-xs mt-2 text-[#8B949E]">{resendMessage}</p>
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
