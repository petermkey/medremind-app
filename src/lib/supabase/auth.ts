'use client';
import { getSupabaseClient } from './client';
import type { UserProfile } from '@/types';

// ─── Sign up ───────────────────────────────────────────────────────────────

export async function supabaseSignUp(
  email: string,
  password: string,
  name: string,
  timezone: string,
): Promise<{ profile: UserProfile | null; error: string | null }> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { name, timezone },
    },
  });

  if (error) return { profile: null, error: error.message };
  if (!data.user) return { profile: null, error: 'No user returned' };

  const profile: UserProfile = {
    id: data.user.id,
    email: data.user.email!,
    name,
    timezone,
    onboarded: false,
    createdAt: data.user.created_at,
  };

  return { profile, error: null };
}

// ─── Sign in ───────────────────────────────────────────────────────────────

export async function supabaseSignIn(
  email: string,
  password: string,
): Promise<{ profile: UserProfile | null; error: string | null }> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) return { profile: null, error: error.message };
  if (!data.user) return { profile: null, error: 'Sign-in failed' };

  // Try to load profile from DB
  const { data: profileRow } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', data.user.id)
    .single();

  const profile: UserProfile = {
    id: data.user.id,
    email: data.user.email!,
    name: profileRow?.name ?? data.user.user_metadata?.name ?? email.split('@')[0],
    timezone: profileRow?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    ageRange: profileRow?.age_range,
    onboarded: profileRow?.onboarded ?? false,
    createdAt: data.user.created_at,
  };

  return { profile, error: null };
}

// ─── Sign out ─────────────────────────────────────────────────────────────

export async function supabaseSignOut(): Promise<void> {
  const supabase = getSupabaseClient();
  await supabase.auth.signOut();
}

// ─── Get current session (used on app load) ───────────────────────────────

export async function getCurrentUser(): Promise<UserProfile | null> {
  const supabase = getSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profileRow } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  return {
    id: user.id,
    email: user.email!,
    name: profileRow?.name ?? user.user_metadata?.name ?? user.email!.split('@')[0],
    timezone: profileRow?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    ageRange: profileRow?.age_range,
    onboarded: profileRow?.onboarded ?? false,
    createdAt: user.created_at,
  };
}

// ─── Save profile to Supabase ──────────────────────────────────────────────

export async function saveProfile(profile: Partial<UserProfile> & { id: string }) {
  const supabase = getSupabaseClient();
  await supabase.from('profiles').upsert({
    id: profile.id,
    name: profile.name,
    timezone: profile.timezone,
    age_range: profile.ageRange,
    onboarded: profile.onboarded,
  });
}
