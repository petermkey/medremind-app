import Link from 'next/link';

export default function Home() {
  return (
    <div className="min-h-screen bg-[var(--bg)] flex flex-col items-center justify-center p-8 text-center">
      {/* Logo */}
      <div className="w-16 h-16 rounded-2xl bg-[var(--blue)] flex items-center justify-center text-3xl mb-6 shadow-[0_8px_32px_rgba(var(--blue-rgb),0.4)]">
        💊
      </div>

      <h1 className="text-3xl font-extrabold text-[var(--text)] mb-2">MedRemind</h1>
      <p className="text-[var(--muted)] mb-10 max-w-xs leading-relaxed">
        Protocol management and medication adherence tracking. Built for people who take health seriously.
      </p>

      <div className="flex flex-col gap-3 w-full max-w-xs">
        <Link
          href="/register"
          className="w-full bg-[var(--blue)] hover:bg-[var(--blue-dk)] text-[var(--blue-on)] font-semibold py-4 rounded-[14px] text-center transition-colors shadow-[0_8px_32px_rgba(var(--blue-rgb),0.35)]"
        >
          Get started — it&apos;s free
        </Link>
        <Link
          href="/login"
          className="w-full bg-transparent border border-[rgba(var(--overlay-rgb),0.12)] hover:border-[var(--blue)] text-[var(--text)] font-semibold py-4 rounded-[14px] text-center transition-colors"
        >
          Sign in
        </Link>
      </div>

      <p className="text-xs text-[var(--muted)] mt-12 max-w-xs leading-relaxed">
        Not a substitute for medical advice. Always consult your healthcare provider.
      </p>
    </div>
  );
}
