import Link from 'next/link';

export default function Home() {
  return (
    <div className="min-h-screen bg-[#0e1013] flex flex-col items-center justify-center p-8 text-center">
      {/* Logo */}
      <div className="w-16 h-16 rounded-2xl bg-[#d9a53f] flex items-center justify-center text-3xl mb-6 shadow-[0_8px_32px_rgba(217,165,63,0.4)]">
        💊
      </div>

      <h1 className="text-3xl font-extrabold text-[#e8e6e1] mb-2">MedRemind</h1>
      <p className="text-[#9b978f] mb-10 max-w-xs leading-relaxed">
        Protocol management and medication adherence tracking. Built for people who take health seriously.
      </p>

      <div className="flex flex-col gap-3 w-full max-w-xs">
        <Link
          href="/register"
          className="w-full bg-[#d9a53f] hover:bg-[#a67c2a] text-white font-semibold py-4 rounded-[14px] text-center transition-colors shadow-[0_8px_32px_rgba(217,165,63,0.35)]"
        >
          Get started — it&apos;s free
        </Link>
        <Link
          href="/login"
          className="w-full bg-transparent border border-[rgba(255,255,255,0.12)] hover:border-[#d9a53f] text-[#e8e6e1] font-semibold py-4 rounded-[14px] text-center transition-colors"
        >
          Sign in
        </Link>
      </div>

      <p className="text-xs text-[#9b978f] mt-12 max-w-xs leading-relaxed">
        Not a substitute for medical advice. Always consult your healthcare provider.
      </p>
    </div>
  );
}
