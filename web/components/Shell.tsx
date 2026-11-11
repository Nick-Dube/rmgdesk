'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut } from 'aws-amplify/auth';
import type { ReactNode } from 'react';
import { useMe } from './MeContext';

const BASE_NAV = [
  { href: '/', label: 'Home', short: 'Home' },
  { href: '/new/', label: 'Raise a request', short: 'Raise' },
  { href: '/tickets/', label: 'Tickets', short: 'Tickets' },
];

export function Shell({ children }: { children: ReactNode }) {
  const me = useMe();
  const path = usePathname();
  const NAV = [
    ...BASE_NAV,
    ...(me?.seesAll || me?.worksTickets ? [{ href: '/insights/', label: 'Insights', short: 'Insights' }] : []),
    ...(me?.role === 'rmg_superuser' || me?.role === 'vertex_superuser' ? [{ href: '/admin/', label: 'Admin', short: 'Admin' }] : []),
  ];
  const active = (href: string) => (href === '/' ? path === '/' : path.startsWith(href));
  const envName = process.env.NEXT_PUBLIC_ENV_NAME;

  return (
    <div className="min-h-dvh bg-[#f6f7f9] text-stone-900">
      {envName && envName !== 'prod' && (
        <div className="bg-amber-400 px-4 py-1 text-center text-xs font-semibold text-stone-900">
          {envName.toUpperCase()} - test data only
        </div>
      )}
      <header className="sticky top-0 z-20 bg-[#0b2545] text-white shadow">
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-4 py-3">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <img src="/rmg-logo-white.png" alt="Royal Museums Greenwich" className="h-8 w-auto" />
            <span>RMG Helpdesk</span>
          </Link>
          <nav className="ml-2 hidden gap-1 md:flex">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className={`rounded-lg px-3 py-2 text-sm ${active(n.href) ? 'bg-white/15' : 'text-white/80 hover:bg-white/10'}`}
              >
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="hidden text-white/80 lg:inline">{me?.fullName}</span>
            <button
              onClick={() => signOut()}
              className="rounded-lg px-3 py-2 text-white/80 ring-1 ring-white/25 hover:bg-white/10"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 pb-28 pt-6 md:pb-12">{children}</main>

      {/* Phone navigation: thumb-reachable at the bottom of the screen */}
      <nav
        className="fixed inset-x-0 bottom-0 z-20 grid border-t border-stone-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden"
        style={{ gridTemplateColumns: `repeat(${NAV.length}, minmax(0, 1fr))` }}
      >
        {NAV.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            className={`relative py-3 text-center text-sm font-medium ${active(n.href) ? 'text-[#0b2545]' : 'text-stone-500'}`}
          >
            {active(n.href) && <span className="absolute inset-x-4 top-0 h-0.5 rounded-full bg-[#0b2545]" />}
            {n.short}
          </Link>
        ))}
      </nav>
    </div>
  );
}
