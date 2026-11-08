import Link from 'next/link';
import type { TicketSummary } from '@/lib/types';
import { when } from '@/lib/format';
import { PriorityBadge, StatusBadge } from './Badges';

export function TicketList({ tickets, empty }: { tickets: TicketSummary[]; empty: string }) {
  if (!tickets.length) {
    return <p className="rounded-2xl bg-white p-6 text-center text-stone-500 ring-1 ring-stone-200">{empty}</p>;
  }
  return (
    <ul className="divide-y divide-stone-200 overflow-hidden rounded-2xl bg-white ring-1 ring-stone-200">
      {tickets.map((t) => (
        <li key={t.id}>
          <Link href={`/ticket/?id=${t.id}`} className="flex flex-col gap-1 px-4 py-3 hover:bg-stone-50 sm:flex-row sm:items-center sm:gap-4">
            <div className="flex items-center gap-2">
              <PriorityBadge priority={t.priority} />
              <span className="font-mono text-xs text-stone-500">{t.reference}</span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{t.title}</p>
              <p className="truncate text-sm text-stone-500">
                {t.siteCode} · {t.building}
                {t.location ? ` · ${t.location}` : ''} · {t.category}
              </p>
            </div>
            <div className="flex items-center gap-3 sm:flex-col sm:items-end sm:gap-1">
              <StatusBadge status={t.status} />
              <span className="text-xs text-stone-500">{when(t.createdAt)}</span>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
