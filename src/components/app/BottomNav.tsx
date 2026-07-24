'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV = [
  { href: '/app',           label: 'Sched'  },
  { href: '/app/food',      label: 'Food'   },
  { href: '/app/meds',      label: 'Meds'   },
  { href: '/app/protocols', label: 'Stacks' },
  { href: '/app/progress',  label: 'Data'   },
  { href: '/app/settings',  label: 'Setup'  },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="flex justify-around items-center px-1 pt-3 pb-5 bg-[rgba(var(--ink-rgb),0.94)] backdrop-blur-xl border-t border-[var(--border)] flex-shrink-0">
      {NAV.map(({ href, label }) => {
        const active = pathname === href || (href !== '/app' && pathname.startsWith(href));
        return (
          <Link
            key={href}
            href={href}
            className={[
              'flex min-w-0 flex-1 flex-col items-center font-mono text-[9.5px] uppercase tracking-[0.08em] px-0.5 py-1 rounded-md transition-colors duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--blue)] focus-visible:outline-offset-2',
              active ? 'text-[var(--blue-text)]' : 'text-[var(--faint)] hover:text-[var(--muted)]',
            ].join(' ')}
          >
            <span className={['mb-1.5 block h-[3px] w-[18px] rounded-[2px] bg-current', active ? 'opacity-100' : 'opacity-40'].join(' ')} />
            <span className="truncate">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
