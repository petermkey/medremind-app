'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useStore } from '@/lib/store/store';
import { supabaseSignUp } from '@/lib/supabase/auth';
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
  const router = useRouter();
  const store = useStore();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const err = validate(name, email, password, confirm);
    if (err) { setError(err); return; }
    if (!agreed) { setError('Please accept the terms to continue.'); return; }

    setLoading(true);
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const { profile, error: authError } = await supabaseSignUp(email, password, name.trim(), timezone);
    setLoading(false);

    if (authError || !profile) {
      setError(authError ?? 'Registration failed. Please try again.');
      return;
    }

    store.updateProfile(profile);
    router.push('/onboarding');
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
