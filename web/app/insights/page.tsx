'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { ROOT_CAUSES, STATUS_LABEL, shortDate } from '@/lib/format';
import type { Insights } from '@/lib/types';
import { useMe } from '@/components/MeContext';

// Chart colours: one hue for single measures; raised / resolved are a validated pair (CVD-safe on white).
const RAISED = '#2f5f9e';
const RESOLVED = '#c4870a';

const monthFmt = new Intl.DateTimeFormat('en-GB', { month: 'short' });
const monthLong = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' });

export default function InsightsPage() {
  const me = useMe();
  const [days, setDays] = useState(90);
  const [data, setData] = useState<Insights | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [table, setTable] = useState(false);

  useEffect(() => {
    setData(null);
    api<Insights>(`/insights?days=${days}`).then(setData).catch((e) => setError(e.message));
  }, [days]);

  if (me && !me.seesAll && !me.worksTickets) return <p className="rounded-2xl bg-white p-6 ring-1 ring-stone-200">Insights are for helpdesk staff and viewers.</p>;

  const s = data?.summary;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Insights</h1>
          <p className="text-sm text-stone-600">{data?.scope === 'teams' ? 'Requests for your teams.' : 'Every request on the estate.'}</p>
        </div>
        <div className="flex gap-1 rounded-xl bg-stone-100 p-1" role="group" aria-label="Period">
          {[30, 90, 365].map((d) => (
            <button key={d} onClick={() => setDays(d)} aria-pressed={days === d} className={`rounded-lg px-3 py-1.5 text-sm font-medium ${days === d ? 'bg-[#0b2545] text-white' : 'text-stone-600 hover:bg-stone-200'}`}>
              {d === 365 ? '12 months' : `${d} days`}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="field-error">{error}</p>}
      {!data && !error && <p className="text-stone-500">Loading…</p>}

      {data && s && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Tile label="Open now" value={s.openNow} note={s.openP1 ? `${s.openP1} at P1` : 'None at P1'} alert={s.openP1 > 0} />
            <Tile label="Raised" value={s.raised} note={`Resolved ${s.resolved}`} />
            <Tile label="Average time to resolve" value={s.avgDaysToResolve === null ? '–' : `${s.avgDaysToResolve} d`} note="Raised to completed" />
            <Tile
              label="Satisfaction"
              value={s.satisfaction === null ? '–' : `${s.satisfaction} / 5`}
              note={`${s.ratings} rating${s.ratings === 1 ? '' : 's'}${s.reopenRate !== null ? ` · ${s.reopenRate}% reopened` : ''}`}
            />
          </div>

          <Card title="Raised and resolved, by month" action={<button onClick={() => setTable((t) => !t)} className="text-sm font-medium text-[#0b2545] underline-offset-4 hover:underline">{table ? 'Show chart' : 'Show table'}</button>}>
            {table ? <TrendTable trend={data.trend} /> : <Trend trend={data.trend} />}
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card title="Open requests by age" subtitle="How long open requests have been waiting">
              <Bars rows={data.backlog.ageing.map((r) => ({ label: r.label, value: r.n }))} ordered />
            </Card>
            <Card title="Open requests by status">
              <Bars rows={data.backlog.byStatus.sort((a, b) => b.n - a.n).map((r) => ({ label: STATUS_LABEL[r.label] ?? r.label, value: r.n }))} />
            </Card>
            <Card title="By team" subtitle={`Raised in the period, with open now and average days to resolve`}>
              <Bars rows={data.byServiceLine.map((r) => ({ label: r.label, value: r.raised, extra: `${r.open} open${r.avgDaysToResolve !== null ? ` · ${r.avgDaysToResolve} d` : ''}` }))} />
            </Card>
            <Card title="By category" subtitle="Top 12, raised in the period">
              <Bars rows={data.byCategory.map((r) => ({ label: r.label, value: r.raised, extra: `${r.open} open` }))} />
            </Card>
            <Card title="By site">
              <Bars rows={data.bySite.map((r) => ({ label: r.label, value: r.raised, extra: `${r.open} open` }))} />
            </Card>
            <Card title="Root causes" subtitle="Recorded when a request is completed">
              <Bars rows={data.rootCauses.map((r) => ({ label: ROOT_CAUSES[r.cause] ?? r.cause, value: r.n, muted: r.cause === 'not_recorded' }))} />
            </Card>
          </div>

          <Card title="Repeat problems" subtitle="The same category in the same building 3 or more times in the period: candidates for a permanent fix">
            {data.repeats.length ? (
              <div className="-mx-5 overflow-x-auto">
                <table className="w-full min-w-[480px] text-left text-sm">
                  <thead className="text-xs uppercase tracking-wide text-stone-500">
                    <tr>
                      <th className="px-5 py-2 font-medium">Building</th>
                      <th className="px-5 py-2 font-medium">Category</th>
                      <th className="px-5 py-2 text-right font-medium">Times</th>
                      <th className="px-5 py-2 font-medium">Latest</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {data.repeats.map((r) => (
                      <tr key={`${r.building}-${r.category}`}>
                        <td className="px-5 py-2.5">
                          {r.building} <span className="text-stone-400">{r.siteCode}</span>
                        </td>
                        <td className="px-5 py-2.5">{r.category}</td>
                        <td className="px-5 py-2.5 text-right font-semibold tabular-nums">{r.n}</td>
                        <td className="px-5 py-2.5">
                          <Link href={`/ticket/?id=${r.lastTicketId}`} className="text-[#0b2545] underline-offset-2 hover:underline">{shortDate(r.lastRaised)}</Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-stone-500">No repeats in this period.</p>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function Tile({ label, value, note, alert }: { label: string; value: number | string; note?: string; alert?: boolean }) {
  return (
    <div className="rounded-2xl bg-white p-4 ring-1 ring-stone-200">
      <p className="text-xs font-medium uppercase tracking-wide text-stone-500">{label}</p>
      <p className="mt-1 text-3xl font-semibold tabular-nums text-stone-900">{value}</p>
      {note && <p className={`mt-1 text-xs ${alert ? 'font-semibold text-rose-700' : 'text-stone-500'}`}>{alert && '▲ '}{note}</p>}
    </div>
  );
}

function Card({ title, subtitle, action, children }: { title: string; subtitle?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl bg-white p-5 ring-1 ring-stone-200">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">{title}</h2>
          {subtitle && <p className="text-xs text-stone-500">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Ranked horizontal bars, one hue, value at the end of each bar. */
function Bars({ rows, ordered }: { rows: { label: string; value: number; extra?: string; muted?: boolean }[]; ordered?: boolean }) {
  if (!rows.length || rows.every((r) => !r.value)) return <p className="text-stone-500">Nothing in this period.</p>;
  const max = Math.max(...rows.map((r) => r.value), 1);
  const list = ordered ? rows : [...rows].sort((a, b) => b.value - a.value);
  return (
    <ul className="space-y-2.5">
      {list.map((r) => (
        <li key={r.label} className="group" title={`${r.label}: ${r.value}${r.extra ? ` (${r.extra})` : ''}`}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate text-stone-700">{r.label}</span>
            <span className="shrink-0 tabular-nums text-stone-900">
              <span className="font-semibold">{r.value}</span>
              {r.extra && <span className="ml-2 text-xs text-stone-500">{r.extra}</span>}
            </span>
          </div>
          <div className="h-2 rounded-full bg-stone-100">
            <div
              className="h-2 rounded-full transition-opacity group-hover:opacity-80"
              style={{ width: r.value ? `${Math.max(2, (100 * r.value) / max)}%` : '0%', background: r.muted ? '#a8a29e' : RAISED }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Grouped columns per month with a hover readout. */
function Trend({ trend }: { trend: Insights['trend'] }) {
  const [hover, setHover] = useState<number | null>(null);
  if (!trend.length) return <p className="text-stone-500">No requests yet.</p>;
  const max = Math.max(...trend.flatMap((t) => [t.raised, t.resolved]), 1);
  const step = Math.pow(10, Math.floor(Math.log10(max)));
  const top = Math.ceil(max / step) * step;
  const ticks = [0, top / 2, top];
  const active = hover ?? trend.length - 1;
  const at = trend[active];
  const label = (m: string) => monthFmt.format(new Date(`${m}-01T00:00:00Z`));

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
        <Legend colour={RAISED} label="Raised" />
        <Legend colour={RESOLVED} label="Resolved" />
        <span className="ml-auto text-stone-600" aria-live="polite">
          <span className="font-medium text-stone-900">{monthLong.format(new Date(`${at.month}-01T00:00:00Z`))}</span>: {at.raised} raised, {at.resolved} resolved
        </span>
      </div>
      <div className="relative h-52 pl-8" onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <div key={t} className="absolute left-8 right-0 border-t border-stone-100" style={{ bottom: `${(100 * t) / top}%` }}>
            <span className="absolute -left-8 -top-2 w-6 text-right text-[11px] tabular-nums text-stone-400">{t}</span>
          </div>
        ))}
        <div className="relative flex h-full items-end gap-1 sm:gap-2">
          {trend.map((t, i) => (
            <button
              key={t.month}
              type="button"
              onMouseEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              aria-label={`${t.month}: ${t.raised} raised, ${t.resolved} resolved`}
              className={`flex h-full flex-1 items-end justify-center gap-[2px] rounded-md ${i === active ? 'bg-stone-100' : ''}`}
            >
              <span className="w-full max-w-3 rounded-t" style={{ height: `${(100 * t.raised) / top}%`, background: RAISED }} />
              <span className="w-full max-w-3 rounded-t" style={{ height: `${(100 * t.resolved) / top}%`, background: RESOLVED }} />
            </button>
          ))}
        </div>
      </div>
      <div className="mt-1 flex gap-1 pl-8 sm:gap-2">
        {trend.map((t, i) => (
          <span key={t.month} className={`flex-1 text-center text-[11px] ${i === active ? 'font-medium text-stone-800' : 'text-stone-400'}`}>
            {label(t.month)}
          </span>
        ))}
      </div>
    </div>
  );
}

function TrendTable({ trend }: { trend: Insights['trend'] }) {
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs uppercase tracking-wide text-stone-500">
        <tr>
          <th className="py-2 font-medium">Month</th>
          <th className="py-2 text-right font-medium">Raised</th>
          <th className="py-2 text-right font-medium">Resolved</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-stone-100 tabular-nums">
        {trend.map((t) => (
          <tr key={t.month}>
            <td className="py-2">{monthLong.format(new Date(`${t.month}-01T00:00:00Z`))}</td>
            <td className="py-2 text-right">{t.raised}</td>
            <td className="py-2 text-right">{t.resolved}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Legend({ colour, label }: { colour: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-stone-700">
      <span className="h-2.5 w-2.5 rounded-sm" style={{ background: colour }} />
      {label}
    </span>
  );
}
