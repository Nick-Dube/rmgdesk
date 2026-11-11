'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState, type FormEvent } from 'react';
import { api } from '@/lib/api';
import type { TicketDetail, TicketEvent } from '@/lib/types';
import { ROOT_CAUSES, STATUS_LABEL, when } from '@/lib/format';
import { formatBytes } from '@/lib/image';
import { useMe } from '@/components/MeContext';
import { PriorityBadge, StatusBadge } from '@/components/Badges';
import { TicketActions } from '@/components/TicketActions';
import type { Status } from '@/lib/types';

const ACTION_WORDS: Record<string, string> = {
  acknowledge: 'Acknowledged',
  attending: 'Engineer attending',
  made_safe: 'Made safe',
  hold: 'Put on hold',
  resume: 'Work resumed',
  resolve: 'Completed',
  cancel: 'Cancelled',
  reopen: 'Reopened',
  confirm_fixed: 'Confirmed fixed',
  not_fixed: 'Not fixed: sent back to the team',
  withdraw: 'Withdrawn',
  auto_close: 'Closed automatically',
};

function parse(data: TicketEvent['data']): Record<string, unknown> {
  if (!data) return {};
  if (typeof data === 'string') {
    try {
      return JSON.parse(data);
    } catch {
      return {};
    }
  }
  return data;
}

function describe(e: TicketEvent): string {
  const d = parse(e.data);
  switch (e.type) {
    case 'created':
      return 'Request raised';
    case 'comment':
      return 'Comment';
    case 'internal_note':
      return 'Internal note';
    case 'status_changed':
      return ACTION_WORDS[String(d.action)] ?? (d.to ? STATUS_LABEL[d.to as Status] : 'Status changed');
    case 'assigned':
      return 'Assignment';
    case 'priority_changed':
      return 'Priority changed';
    case 'category_changed':
      return 'Category changed';
    case 'integration':
      return 'MRI Evolution';
    case 'email_sent':
      return 'Email';
    case 'sla':
      return 'Helpdesk';
    default:
      return e.type.replace(/_/g, ' ');
  }
}

const STEPS: { key: string; label: string; done: (s: Status) => boolean }[] = [
  { key: 'raised', label: 'Raised', done: () => true },
  { key: 'with-team', label: 'With the team', done: (s) => s !== 'new' },
  { key: 'in-progress', label: 'In progress', done: (s) => ['attending', 'made_safe', 'resolved', 'closed'].includes(s) },
  { key: 'complete', label: 'Complete', done: (s) => ['resolved', 'closed'].includes(s) },
];

/** A simple progress line for requesters: where is my request? */
function Progress({ status }: { status: Status }) {
  if (status === 'cancelled') return null;
  return (
    <ol className="grid grid-cols-4 gap-1" aria-label="Progress">
      {STEPS.map((s) => {
        const done = s.done(status);
        return (
          <li key={s.key} className="text-center">
            <div className={`h-1.5 rounded-full ${done ? 'bg-[#0b2545]' : 'bg-stone-200'}`} />
            <p className={`mt-1.5 text-[11px] sm:text-xs ${done ? 'font-medium text-stone-800' : 'text-stone-400'}`}>{s.label}</p>
          </li>
        );
      })}
    </ol>
  );
}

function TicketView() {
  const params = useSearchParams();
  const id = params.get('id');
  const confirm = params.get('confirm');
  const me = useMe();
  const [data, setData] = useState<TicketDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [moved, setMoved] = useState<string | null>(null);
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
  if (moved)
    return (
      <div className="rounded-2xl bg-white p-6 ring-1 ring-stone-200">
        <p className="font-medium">{moved}</p>
        <Link href="/tickets/" className="mt-3 inline-block font-medium text-[#0b2545] underline">Back to tickets</Link>
      </div>
    );
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
          {!data.canWork && (
            <div className="mt-4">
              <Progress status={t.status} />
            </div>
          )}
          {t.status === 'on_hold' && t.holdReason && (
            <p className="mt-4 rounded-xl bg-stone-100 px-4 py-3 text-sm text-stone-800">
              <span className="font-semibold">On hold:</span> {t.holdReason}
            </p>
          )}
          <p className="mt-4 whitespace-pre-wrap text-stone-700">{t.description}</p>
        </div>

        <div className="space-y-3 lg:hidden">
          <TicketActions data={data} meId={me?.id ?? 0} confirm={confirm} onChange={setData} onMoved={setMoved} />
        </div>

        {data.attachments.length > 0 && (
          <div className="flex flex-wrap gap-3">
            {data.attachments.map((a) => (
              <a key={a.id} href={a.url} target="_blank" rel="noreferrer" title={a.stage === 'after' ? 'After the work' : a.fileName} className="relative block h-28 w-28 overflow-hidden rounded-xl bg-stone-100 ring-1 ring-stone-200">
                {a.stage === 'after' && <span className="absolute left-1.5 top-1.5 rounded-md bg-emerald-700 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white">After</span>}
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

      <div className="h-fit space-y-4 lg:sticky lg:top-20">
      <div className="hidden space-y-3 lg:block">
        <TicketActions data={data} meId={me?.id ?? 0} confirm={confirm} onChange={setData} onMoved={setMoved} />
      </div>
      <aside className="space-y-3 rounded-2xl bg-white p-5 text-sm ring-1 ring-stone-200">
        {data.canWork && <Detail label="Status" value={STATUS_LABEL[t.status]} />}
        <Detail label="Assigned to" value={t.assignee?.name ?? (data.canWork ? 'Nobody yet' : null)} />
        <Detail label="Site" value={t.site.name} />
        <Detail label="Building" value={t.building} />
        <Detail label="Location" value={t.location} />
        <Detail label="Category" value={t.category} />
        <Detail label="With" value={t.serviceLine ?? 'Vertex helpdesk (triage)'} />
        <Detail label="Raised by" value={t.requester.name} />
        {data.canWork && t.requester.email && <DetailLink label="Email" href={`mailto:${t.requester.email}`} value={t.requester.email} />}
        {t.contactPhone && <DetailLink label="Phone" href={`tel:${t.contactPhone.replace(/\s/g, '')}`} value={t.contactPhone} />}
        <Detail label="Department" value={t.department} />
        <Detail label="Raised" value={when(t.createdAt)} />
        {t.evolutionTaskNo && <Detail label="MRI Evolution task" value={t.evolutionTaskNo} />}
        {t.resolvedAt && <Detail label="Completed" value={when(t.resolvedAt)} />}
        {t.resolutionNote && !data.actions.includes('confirm_fixed') && <Detail label="What was done" value={t.resolutionNote} />}
        {t.rootCause && <Detail label="Cause" value={ROOT_CAUSES[t.rootCause] ?? t.rootCause} />}
        {t.satisfaction && <Detail label="Rating" value={`${'★'.repeat(t.satisfaction)}${'☆'.repeat(5 - t.satisfaction)}`} />}
        {t.closedAt && <Detail label={t.status === 'cancelled' ? 'Cancelled' : 'Closed'} value={when(t.closedAt)} />}
      </aside>
      </div>
    </div>
  );
}

function DetailLink({ label, value, href }: { label: string; value: string; href: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-stone-500">{label}</p>
      <a href={href} className="break-all text-[#0b2545] underline-offset-2 hover:underline">{value}</a>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-stone-500">{label}</p>
      <p className="whitespace-pre-wrap text-stone-900">{value}</p>
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
