'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState, type FormEvent } from 'react';
import { api } from '@/lib/api';
import type { TicketDetail, TicketEvent } from '@/lib/types';
import { when } from '@/lib/format';
import { formatBytes } from '@/lib/image';
import { useMe } from '@/components/MeContext';
import { PriorityBadge, StatusBadge } from '@/components/Badges';

function describe(e: TicketEvent): string {
  switch (e.type) {
    case 'created':
      return 'Request raised';
    case 'comment':
      return 'Comment';
    case 'internal_note':
      return 'Internal note';
    case 'status_changed':
      return 'Status changed';
    case 'assigned':
      return 'Assigned';
    case 'integration':
      return 'Vertex';
    case 'email_sent':
      return 'Email sent';
    default:
      return e.type.replace(/_/g, ' ');
  }
}

function TicketView() {
  const id = useSearchParams().get('id');
  const me = useMe();
  const [data, setData] = useState<TicketDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [internal, setInternal] = useState(false);
  const [sending, setSending] = useState(false);

  const load = useCallback(() => {
    if (!id) return;
    api<TicketDetail>(`/tickets/${encodeURIComponent(id)}`).then(setData).catch((e) => setError(e.message));
  }, [id]);

  useEffect(load, [load]);

  async function send(ev: FormEvent) {
    ev.preventDefault();
    if (!comment.trim()) return;
    setSending(true);
    try {
      await api(`/tickets/${id}/comments`, { method: 'POST', body: JSON.stringify({ body: comment, isInternal: internal }) });
      setComment('');
      setInternal(false);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  if (!id) return <p>No ticket selected.</p>;
  if (error) return <p className="field-error">{error}</p>;
  if (!data) return <p className="text-stone-500">Loading…</p>;
  const t = data.ticket;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
      <div className="space-y-6">
        <div>
          <Link href="/tickets/" className="text-sm text-stone-500 hover:underline">← Tickets</Link>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <PriorityBadge priority={t.priority} />
            <span className="font-mono text-sm text-stone-500">{t.reference}</span>
            <StatusBadge status={t.status} />
          </div>
          <h1 className="mt-2 text-2xl font-semibold">{t.title}</h1>
          <p className="mt-3 whitespace-pre-wrap text-stone-700">{t.description}</p>
        </div>

        {data.attachments.length > 0 && (
          <div className="flex flex-wrap gap-3">
            {data.attachments.map((a) => (
              <a key={a.id} href={a.url} target="_blank" rel="noreferrer" className="block h-28 w-28 overflow-hidden rounded-xl bg-stone-100 ring-1 ring-stone-200">
                {a.contentType.startsWith('image/') ? (
                  <img src={a.url} alt={a.fileName} className="h-full w-full object-cover" />
                ) : (
                  <span className="flex h-full flex-col items-center justify-center p-2 text-center text-xs text-stone-600">
                    {a.fileName}
                    <span className="mt-1 text-stone-400">{formatBytes(a.size)}</span>
                  </span>
                )}
              </a>
            ))}
          </div>
        )}

        <section>
          <h2 className="mb-3 font-semibold">Timeline</h2>
          <ol className="relative space-y-4 border-l-2 border-stone-200 pl-5">
            {data.events.map((e) => (
              <li key={e.id} className="relative">
                <span className={`absolute -left-[27px] top-1.5 h-3 w-3 rounded-full ring-4 ring-[#f6f7f9] ${e.isInternal ? 'bg-amber-500' : 'bg-[#0b2545]'}`} />
                <div className={`rounded-xl p-3 ${e.isInternal ? 'bg-amber-50 ring-1 ring-amber-200' : 'bg-white ring-1 ring-stone-200'}`}>
                  <p className="text-sm">
                    <span className="font-medium">{describe(e)}</span>
                    {e.actorName && <span className="text-stone-500"> · {e.actorName}</span>}
                    <span className="text-stone-400"> · {when(e.createdAt)}</span>
                  </p>
                  {e.body && <p className="mt-1 whitespace-pre-wrap text-stone-700">{e.body}</p>}
                </div>
              </li>
            ))}
          </ol>
        </section>

        <form onSubmit={send} className="space-y-3 rounded-2xl bg-white p-4 ring-1 ring-stone-200">
          <label htmlFor="comment" className="field-label">Add an update</label>
          <textarea id="comment" rows={3} className="field-input" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Anything that helps: it's got worse, it's been fixed, access details…" />
          <div className="flex items-center justify-between gap-3">
            {me?.worksTickets ? (
              <label className="flex items-center gap-2 text-sm text-stone-700">
                <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} className="accent-amber-600" />
                Internal note (staff only)
              </label>
            ) : (
              <span />
            )}
            <button disabled={sending || !comment.trim()} className="rounded-xl bg-[#0b2545] px-4 py-2 font-semibold text-white disabled:opacity-50">
              {sending ? 'Sending…' : 'Send'}
            </button>
          </div>
        </form>
      </div>

      <aside className="h-fit space-y-3 rounded-2xl bg-white p-5 text-sm ring-1 ring-stone-200">
        <Detail label="Site" value={t.site.name} />
        <Detail label="Building" value={t.building} />
        <Detail label="Location" value={t.location} />
        <Detail label="Category" value={t.category} />
        <Detail label="With" value={t.serviceLine ?? 'Vertex helpdesk (triage)'} />
        <Detail label="Raised by" value={t.requester.name} />
        <Detail label="Department" value={t.department} />
        <Detail label="Raised" value={when(t.createdAt)} />
        {t.evolutionTaskNo && <Detail label="MRI Evolution task" value={t.evolutionTaskNo} />}
      </aside>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-stone-500">{label}</p>
      <p className="text-stone-900">{value}</p>
    </div>
  );
}

export default function TicketPage() {
  return (
    <Suspense fallback={<p className="text-stone-500">Loading…</p>}>
      <TicketView />
    </Suspense>
  );
}
