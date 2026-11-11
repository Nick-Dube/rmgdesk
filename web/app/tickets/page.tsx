'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { TicketSummary } from '@/lib/types';
import { useMe } from '@/components/MeContext';
import { TicketList } from '@/components/TicketList';

type Scope = 'mine' | 'assigned' | 'queue' | 'all';
type StatusFilter = 'open' | 'closed' | 'any';

export default function Tickets() {
  const me = useMe();
  const scopes: { key: Scope; label: string }[] = [
    { key: 'mine', label: 'Raised by me' },
    ...(me?.worksTickets ? [{ key: 'assigned' as Scope, label: 'Assigned to me' }, { key: 'queue' as Scope, label: 'Team queue' }] : []),
    ...(me?.seesAll ? [{ key: 'all' as Scope, label: 'All tickets' }] : []),
  ];
  const [scope, setScope] = useState<Scope>(me?.worksTickets ? 'queue' : 'mine');
  const [status, setStatus] = useState<StatusFilter>('open');
  const [tickets, setTickets] = useState<TicketSummary[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (before?: number) => {
      setLoading(true);
      setError(null);
      try {
        const qs = new URLSearchParams({ scope, status, limit: '25', ...(before ? { before: String(before) } : {}) });
        const r = await api<{ tickets: TicketSummary[]; next: number | null }>(`/tickets?${qs}`);
        setTickets((prev) => (before ? [...prev, ...r.tickets] : r.tickets));
        setNext(r.next);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [scope, status],
  );

  useEffect(() => {
    load();
  }, [load]);

  const tab = (active: boolean) =>
    `rounded-lg px-3 py-1.5 text-sm font-medium ${active ? 'bg-[#0b2545] text-white' : 'text-stone-600 hover:bg-stone-200'}`;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Tickets</h1>
      <div className="flex flex-wrap items-center gap-2">
        {scopes.length > 1 && (
          <div className="flex max-w-full gap-1 overflow-x-auto rounded-xl bg-stone-100 p-1">
            {scopes.map((s) => (
              <button key={s.key} className={`${tab(scope === s.key)} whitespace-nowrap`} onClick={() => setScope(s.key)}>
                {s.label}
              </button>
            ))}
          </div>
        )}
        <div className="flex gap-1 rounded-xl bg-stone-100 p-1">
          {(['open', 'closed', 'any'] as StatusFilter[]).map((s) => (
            <button key={s} className={tab(status === s)} onClick={() => setStatus(s)}>
              {s === 'any' ? 'All' : s === 'open' ? 'Open' : 'Closed'}
            </button>
          ))}
        </div>
      </div>
      {error && <p className="field-error">{error}</p>}
      {!loading || tickets.length ? <TicketList tickets={tickets} empty="Nothing here." /> : <p className="text-stone-500">Loading…</p>}
      {next && (
        <button onClick={() => load(next)} disabled={loading} className="w-full rounded-xl bg-white py-3 font-medium ring-1 ring-stone-200">
          {loading ? 'Loading…' : 'Show more'}
        </button>
      )}
    </div>
  );
}
