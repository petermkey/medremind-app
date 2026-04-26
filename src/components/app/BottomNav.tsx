'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV = [
  { href: '/app',           icon: '📋', label: 'Schedule' },
  { href: '/app/food',      icon: '🍽️', label: 'Food'     },
  { href: '/app/meds',      icon: '💊', label: 'Meds'     },
  { href: '/app/protocols', icon: '📁', label: 'Protocols' },
  { href: '/app/progress',  icon: '📊', label: 'Progress'  },
  { href: '/app/settings',  icon: '⚙️', label: 'Settings'  },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="flex justify-around items-center px-1 pt-3 pb-5 bg-[rgba(22,27,34,0.97)] backdrop-blur-xl border-t border-[rgba(255,255,255,0.08)] flex-shrink-0">
      {NAV.map(({ href, icon, label }) => {
        const active = pathname === href || (href !== '/app' && pathname.startsWith(href));
        return (
          <Link
            key={href}
            href={href}
            className={[
              'flex min-w-0 flex-1 flex-col items-center gap-1 text-[8px] sm:text-[9px] font-semibold px-0.5 py-1 rounded-xl transition-colors duration-200',
              active ? 'text-[#3B82F6]' : 'text-[#8B949E] hover:text-[#F0F6FC]',
            ].join(' ')}
          >
            <span className="text-[18px] sm:text-[20px] leading-none">{icon}</span>
            <span className="truncate">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
