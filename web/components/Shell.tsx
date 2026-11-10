'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut } from 'aws-amplify/auth';
import type { ReactNode } from 'react';
import { useMe } from './MeContext';

const NAV = [
  { href: '/', label: 'Home' },
  { href: '/new/', label: 'Raise a request' },
  { href: '/tickets/', label: 'Tickets' },
];

export function Shell({ children }: { children: ReactNode }) {
  const me = useMe();
  const path = usePathname();
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
          <nav className="ml-4 hidden gap-1 sm:flex">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className={`rounded-lg px-3 py-2 text-sm ${path === n.href ? 'bg-white/15' : 'text-white/80 hover:bg-white/10'}`}
              >
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="hidden text-white/80 md:inline">{me?.fullName}</span>
            <button
              onClick={() => signOut()}
              className="rounded-lg px-3 py-2 text-white/80 ring-1 ring-white/25 hover:bg-white/10"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 pb-28 pt-6 sm:pb-12">{children}</main>

      {/* Phone navigation: thumb-reachable at the bottom of the screen */}
      <nav className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-3 border-t border-stone-200 bg-white pb-[env(safe-area-inset-bottom)] sm:hidden">
        {NAV.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            className={`py-3 text-center text-sm font-medium ${path === n.href ? 'text-[#0b2545]' : 'text-stone-500'}`}
          >
            {n.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
