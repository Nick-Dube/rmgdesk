'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { TicketSummary } from '@/lib/types';
import { useMe } from '@/components/MeContext';
import { TicketList } from '@/components/TicketList';

export default function Home() {
  const me = useMe();
  const [tickets, setTickets] = useState<TicketSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ tickets: TicketSummary[] }>('/tickets?scope=mine&limit=5')
      .then((r) => setTickets(r.tickets))
      .catch((e) => setError(e.message));
  }, []);

  const firstName = me?.fullName.split(' ')[0];

  return (
    <div className="space-y-8">
      <section className="overflow-hidden rounded-3xl bg-[#0b2545] text-white">
        <div className="p-6 sm:p-10">
          <p className="text-sm text-white/70">Hello{firstName ? `, ${firstName}` : ''}</p>
          <h1 className="mt-1 text-2xl font-semibold sm:text-3xl">Spotted something that needs fixing?</h1>
          <p className="mt-2 max-w-xl text-white/80">
            Raise it here in under a minute. Add a photo, and you&apos;ll be able to follow it until it&apos;s fixed.
          </p>
          <Link
            href="/new/"
            className="mt-6 inline-flex items-center rounded-xl bg-[#f2c14e] px-5 py-3 font-semibold text-[#0b2545] hover:brightness-95"
          >
            Raise a request
          </Link>
        </div>
        <div className="bg-rose-700 px-6 py-3 text-sm font-medium sm:px-10">
          In an emergency, call Security Control on <strong>6555</strong> first.
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">Your recent requests</h2>
          <Link href="/tickets/" className="text-sm font-medium text-[#0b2545] underline-offset-4 hover:underline">
            See all
          </Link>
        </div>
        {error && <p className="field-error">{error}</p>}
        {!tickets && !error && <p className="text-stone-500">Loading…</p>}
        {tickets && <TicketList tickets={tickets} empty="You haven't raised any requests yet." />}
      </section>
    </div>
  );
}
