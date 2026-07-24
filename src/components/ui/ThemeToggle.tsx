'use client';
import { useEffect, useState } from 'react';

type ThemePref = 'system' | 'light' | 'dark';

function applyTheme(pref: ThemePref) {
  const resolved = pref === 'system'
    ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
    : pref;
  document.documentElement.setAttribute('data-theme', resolved);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', resolved === 'light' ? '#f7f5f0' : '#0e1013');
}

export function ThemeToggle() {
  const [pref, setPref] = useState<ThemePref>('system');

  useEffect(() => {
    const stored = localStorage.getItem('theme');
    setPref(stored === 'light' || stored === 'dark' ? stored : 'system');
  }, []);

  function choose(next: ThemePref) {
    setPref(next);
    if (next === 'system') localStorage.removeItem('theme');
    else localStorage.setItem('theme', next);
    applyTheme(next);
  }

  const options: { value: ThemePref; label: string }[] = [
    { value: 'system', label: 'System' },
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
  ];

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="text-xs text-[var(--muted)]">Day Shift (light) or Night Shift (dark)</div>
      <div className="flex gap-1.5">
        {options.map(opt => (
          <button
            key={opt.value}
            type="button"
            onClick={() => choose(opt.value)}
            aria-pressed={pref === opt.value}
            className={`px-3 py-1.5 rounded-lg text-[11px] font-mono uppercase tracking-wide border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--blue-text)] focus-visible:outline-offset-2 ${
              pref === opt.value
                ? 'bg-[var(--blue)] border-[var(--blue)] text-[var(--blue-on)]'
                : 'bg-transparent border-[var(--border-strong)] text-[var(--muted)] hover:border-[var(--faint)] hover:text-[var(--text)]'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}
