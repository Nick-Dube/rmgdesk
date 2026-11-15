'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { STATUS_LABEL, when } from '@/lib/format';
import type { Priority, Status } from '@/lib/types';
import { PriorityBadge, StatusBadge } from '@/components/Badges';
import { useMe } from '@/components/MeContext';

// The requests table: every request the person may see, filtered, sorted and exported.
// The filters live in the page address, so a filtered view can be bookmarked or shared.

type Row = {
  id: number;
  reference: string;
  createdAt: string;
  status: Status;
  priority: Priority;
  title: string;
  siteCode: string;
  building: string;
  location: string | null;
  category: string;
  team: string | null;
  department: string | null;
  requester: string | null;
  assignee: string | null;
  source: string;
};
type Result = { rows: Row[]; total: number; page: number; pageSize: number };
type Choices = {
  sites: { id: number; code: string; name: string }[];
  buildings: { id: number; siteId: number; name: string }[];
  categories: { id: number; label: string; active: boolean }[];
  teams: { id: number; name: string }[];
  departments: string[];
};

const FILTER_KEYS = ['q', 'from', 'to', 'site', 'building', 'category', 'team', 'department', 'status', 'priority', 'requester', 'source', 'assignee'] as const;
type FilterKey = (typeof FILTER_KEYS)[number];
type Filters = Partial<Record<FilterKey, string>>;

const SORTABLE: Record<string, string> = { reference: 'Reference', created: 'Raised', priority: 'Priority', status: 'Status', building: 'Where', category: 'Category', department: 'Department' };

function RequestsTable() {
  const me = useMe();
  const router = useRouter();
  const params = useSearchParams();
  const filters: Filters = useMemo(() => Object.fromEntries(FILTER_KEYS.map((k) => [k, params.get(k) || undefined]).filter(([, v]) => v)), [params]);
  const sort = params.get('sort') || 'created';
  const dir = params.get('dir') || 'desc';
  const page = Number(params.get('page') || 1);

  const [data, setData] = useState<Result | null>(null);
  const [choices, setChoices] = useState<Choices | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showFilters, setShowFilters] = useState(false);
  const [q, setQ] = useState(filters.q ?? '');
  const [exporting, setExporting] = useState<string | null>(null);
  const [exportNote, setExportNote] = useState<string | null>(null);

  const go = useCallback(
    (changes: Record<string, string | undefined>, keepPage = false) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(changes)) {
        if (v) next.set(k, v);
        else next.delete(k);
      }
      if (!keepPage) next.delete('page');
      router.replace(`/requests/?${next.toString()}`);
    },
    [params, router],
  );

  useEffect(() => {
    api<Choices>('/tickets/filters').then(setChoices).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams({ ...(filters as Record<string, string>), sort, dir, page: String(page), pageSize: '50' });
    api<Result>(`/tickets/search?${qs}`)
      .then(setData)
      .catch((e: ApiError) => setError(e.details?.length ? e.details.map((d) => d.message).join(' ') : e.message))
      .finally(() => setLoading(false));
  }, [filters, sort, dir, page]);

  // Search box: wait for typing to pause.
  useEffect(() => {
    if ((filters.q ?? '') === q) return;
    const t = setTimeout(() => go({ q: q.trim() || undefined }), 350);
    return () => clearTimeout(t);
  }, [q, filters.q, go]);

  async function exportAs(format: 'xlsx' | 'csv') {
    setExporting(format);
    setExportNote(null);
    try {
      const r = await api<{ url: string; rows: number }>('/tickets/export', { method: 'POST', body: JSON.stringify({ format, filters, sort, dir }) });
      setExportNote(`${r.rows.toLocaleString('en-GB')} requests exported.`);
      window.location.href = r.url;
    } catch (e) {
      setExportNote((e as Error).message);
    } finally {
      setExporting(null);
    }
  }

  const chips = Object.entries(filters)
    .filter(([k]) => k !== 'q')
    .map(([k, v]) => ({ key: k, text: chipText(k as FilterKey, v!, choices) }));
  const from = data ? (data.page - 1) * data.pageSize + 1 : 0;
  const to = data ? Math.min(data.page * data.pageSize, data.total) : 0;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const buildings = choices?.buildings.filter((b) => !filters.site || String(b.siteId) === filters.site) ?? [];

  const sortBy = (key: string) => go({ sort: key, dir: sort === key && dir === 'desc' ? 'asc' : 'desc' });
  const Th = ({ k, className = '' }: { k: string; className?: string }) => (
    <th className={`px-3 py-2.5 font-medium ${className}`} aria-sort={sort === k ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}>
      <button onClick={() => sortBy(k)} className="inline-flex items-center gap-1 uppercase tracking-wide hover:text-stone-900">
        {SORTABLE[k]}
        <span className={sort === k ? 'text-stone-900' : 'text-stone-300'}>{sort === k && dir === 'asc' ? '▲' : '▼'}</span>
      </button>
    </th>
  );

  return (
    <div className="relative left-1/2 w-[min(calc(100vw-2rem),1400px)] -translate-x-1/2 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Requests</h1>
          <p className="text-sm text-stone-600">
            {data ? `${data.total.toLocaleString('en-GB')} ${data.total === 1 ? 'request' : 'requests'}` : ' '}
            {me && !me.seesAll && !me.worksTickets ? ' you raised or follow' : ''}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => exportAs('xlsx')} disabled={!!exporting || !data?.total} className="rounded-xl bg-[#0b2545] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#08182e] disabled:opacity-50">
            {exporting === 'xlsx' ? 'Preparing…' : 'Export to Excel'}
          </button>
          <button onClick={() => exportAs('csv')} disabled={!!exporting || !data?.total} className="rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-[#0b2545] ring-1 ring-stone-300 hover:bg-stone-50 disabled:opacity-50">
            {exporting === 'csv' ? 'Preparing…' : 'CSV'}
          </button>
        </div>
      </div>
      {exportNote && <p className="text-sm text-stone-600">{exportNote}</p>}

      <div className="rounded-2xl bg-white p-3 ring-1 ring-stone-200">
        <div className="flex flex-wrap gap-2">
          <input
            className="field-input min-w-0 flex-1"
            placeholder="Reference (e.g. RMG-000123), or words in the title, description or location"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search"
          />
          <button onClick={() => setShowFilters((s) => !s)} aria-expanded={showFilters} className={`rounded-xl px-4 py-2.5 text-sm font-medium ring-1 ${showFilters || chips.length ? 'bg-[#0b2545]/5 text-[#0b2545] ring-[#0b2545]' : 'ring-stone-300'}`}>
            Filters{chips.length ? ` (${chips.length})` : ''}
          </button>
        </div>

        {showFilters && (
          <div className="mt-3 grid gap-3 border-t border-stone-100 pt-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Raised from">
              <input type="date" className="field-input" value={filters.from ?? ''} onChange={(e) => go({ from: e.target.value || undefined })} />
            </Field>
            <Field label="Raised to">
              <input type="date" className="field-input" value={filters.to ?? ''} onChange={(e) => go({ to: e.target.value || undefined })} />
            </Field>
            <Field label="Status">
              <select className="field-input" value={filters.status ?? ''} onChange={(e) => go({ status: e.target.value || undefined })}>
                <option value="">Any</option>
                <option value="open">Open (any open status)</option>
                <option value="done">Done (resolved, closed, cancelled)</option>
                {(Object.keys(STATUS_LABEL) as Status[]).map((s) => (
                  <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                ))}
              </select>
            </Field>
            <Field label="Priority">
              <div className="flex gap-1">
                {(['P1', 'P2', 'P3', 'P4'] as const).map((p) => {
                  const list = (filters.priority ?? '').split(',').filter(Boolean);
                  const on = list.includes(p);
                  return (
                    <button
                      key={p}
                      type="button"
                      aria-pressed={on}
                      onClick={() => go({ priority: (on ? list.filter((x) => x !== p) : [...list, p]).sort().join(',') || undefined })}
                      className={`flex-1 rounded-lg py-2 text-sm font-semibold ring-1 ${on ? 'bg-[#0b2545] text-white ring-[#0b2545]' : 'ring-stone-300 hover:bg-stone-50'}`}
                    >
                      {p}
                    </button>
                  );
                })}
              </div>
            </Field>
            <Field label="Site">
              <select className="field-input" value={filters.site ?? ''} onChange={(e) => go({ site: e.target.value || undefined, building: undefined })}>
                <option value="">Any</option>
                {choices?.sites.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Building">
              <select className="field-input" value={filters.building ?? ''} onChange={(e) => go({ building: e.target.value || undefined })}>
                <option value="">Any</option>
                {buildings.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Category">
              <select className="field-input" value={filters.category ?? ''} onChange={(e) => go({ category: e.target.value || undefined })}>
                <option value="">Any</option>
                {choices?.categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
            </Field>
            <Field label="Team">
              <select className="field-input" value={filters.team ?? ''} onChange={(e) => go({ team: e.target.value || undefined })}>
                <option value="">Any</option>
                {choices?.teams.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Department">
              <TextFilter value={filters.department} list="departments" onChange={(v) => go({ department: v })} placeholder="e.g. Estates" />
              <datalist id="departments">
                {choices?.departments.map((d) => (
                  <option key={d} value={d} />
                ))}
              </datalist>
            </Field>
            <Field label="Requester">
              <TextFilter value={filters.requester} onChange={(v) => go({ requester: v })} placeholder="Name or email" />
            </Field>
            <Field label="Assigned to">
              <select className="field-input" value={filters.assignee ?? ''} onChange={(e) => go({ assignee: e.target.value || undefined })}>
                <option value="">Anyone</option>
                <option value="me">Me</option>
                <option value="none">Nobody</option>
              </select>
            </Field>
            <Field label="Source">
              <select className="field-input" value={filters.source ?? ''} onChange={(e) => go({ source: e.target.value || undefined })}>
                <option value="">All</option>
                <option value="live">RMG Desk</option>
                <option value="legacy">Old form (imported)</option>
              </select>
            </Field>
          </div>
        )}

        {chips.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {chips.map((c) => (
              <button key={c.key} onClick={() => go({ [c.key]: undefined, ...(c.key === 'site' ? { building: undefined } : {}) })} className="inline-flex items-center gap-1.5 rounded-full bg-stone-100 px-3 py-1 text-xs text-stone-800 hover:bg-stone-200">
                {c.text} <span aria-hidden>✕</span>
                <span className="sr-only">Remove filter</span>
              </button>
            ))}
            <button onClick={() => router.replace(`/requests/?${new URLSearchParams({ ...(filters.q ? { q: filters.q } : {}), sort, dir })}`)} className="text-xs font-medium text-[#0b2545] underline-offset-2 hover:underline">
              Clear filters
            </button>
          </div>
        )}
      </div>

      {error && <p className="field-error">{error}</p>}

      <div className={`overflow-hidden rounded-2xl bg-white ring-1 ring-stone-200 transition-opacity ${loading ? 'opacity-60' : ''}`}>
        <table className="w-full text-left text-sm">
          <thead className="hidden bg-stone-50 text-xs text-stone-500 md:table-header-group">
            <tr>
              <Th k="reference" />
              <Th k="created" />
              <Th k="priority" />
              <Th k="status" />
              <th className="px-3 py-2.5 font-medium uppercase tracking-wide">Request</th>
              <Th k="building" />
              <Th k="category" className="hidden lg:table-cell" />
              <Th k="department" className="hidden xl:table-cell" />
              <th className="hidden px-3 py-2.5 font-medium uppercase tracking-wide xl:table-cell">People</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {data?.rows.map((r) => (
              <tr key={r.id} className="relative block px-1 py-2 hover:bg-stone-50 md:table-row md:p-0">
                <td className="inline-block px-3 py-1 align-top md:table-cell md:py-2.5">
                  <Link href={`/ticket/?id=${r.id}`} className="font-mono text-xs font-medium text-[#0b2545] after:absolute after:inset-0">
                    {r.reference}
                  </Link>
                </td>
                <td className="inline-block px-3 py-1 align-top text-stone-600 md:table-cell md:whitespace-nowrap md:py-2.5">{when(r.createdAt)}</td>
                <td className="inline-block px-3 py-1 align-top md:table-cell md:py-2.5">
                  <PriorityBadge priority={r.priority} />
                </td>
                <td className="inline-block px-3 py-1 align-top md:table-cell md:py-2.5">
                  <StatusBadge status={r.status} />
                </td>
                <td className="block px-3 py-1 align-top md:table-cell md:max-w-sm md:py-2.5">
                  <span className="line-clamp-2 font-medium text-stone-900">{r.title}</span>
                  <span className="text-xs text-stone-500 lg:hidden">{r.category}</span>
                </td>
                <td className="block px-3 py-1 align-top text-stone-700 md:table-cell md:py-2.5">
                  {r.building} <span className="text-stone-400">{r.siteCode}</span>
                  {r.location && <span className="block text-xs text-stone-500">{r.location}</span>}
                </td>
                <td className="hidden px-3 py-2.5 align-top text-stone-700 lg:table-cell">
                  {r.category}
                  {r.team && <span className="block text-xs text-stone-500">{r.team}</span>}
                </td>
                <td className="hidden px-3 py-2.5 align-top text-stone-700 xl:table-cell">{r.department}</td>
                <td className="hidden px-3 py-2.5 align-top text-xs text-stone-600 xl:table-cell">
                  {r.requester ?? (r.source === 'legacy' ? <span className="whitespace-nowrap text-stone-400">Old form</span> : '')}
                  {r.assignee && <span className="block">→ {r.assignee}</span>}
                </td>
              </tr>
            ))}
            {data && !data.rows.length && (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-stone-500">Nothing matches these filters.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {data && data.total > 0 && (
        <div className="flex items-center justify-between gap-3 text-sm">
          <p className="text-stone-600">
            {from.toLocaleString('en-GB')}–{to.toLocaleString('en-GB')} of {data.total.toLocaleString('en-GB')}
          </p>
          <div className="flex gap-2">
            <button disabled={page <= 1} onClick={() => go({ page: String(page - 1) }, true)} className="rounded-lg px-3 py-1.5 font-medium ring-1 ring-stone-300 hover:bg-white disabled:opacity-40">
              Previous
            </button>
            <span className="px-1 py-1.5 text-stone-500">
              Page {page} of {pages.toLocaleString('en-GB')}
            </span>
            <button disabled={page >= pages} onClick={() => go({ page: String(page + 1) }, true)} className="rounded-lg px-3 py-1.5 font-medium ring-1 ring-stone-300 hover:bg-white disabled:opacity-40">
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-stone-500">{label}</span>
      {children}
    </label>
  );
}

/** A text filter that applies when typing pauses. */
function TextFilter({ value, onChange, placeholder, list }: { value?: string; onChange: (v: string | undefined) => void; placeholder?: string; list?: string }) {
  const [text, setText] = useState(value ?? '');
  useEffect(() => setText(value ?? ''), [value]);
  useEffect(() => {
    if ((value ?? '') === text) return;
    const t = setTimeout(() => onChange(text.trim() || undefined), 400);
    return () => clearTimeout(t);
  }, [text, value, onChange]);
  return <input className="field-input" value={text} list={list} placeholder={placeholder} onChange={(e) => setText(e.target.value)} />;
}

function chipText(key: FilterKey, value: string, choices: Choices | null): string {
  const find = <T extends { id: number }>(list: T[] | undefined, get: (x: T) => string) => {
    const hit = list?.find((x) => String(x.id) === value);
    return hit ? get(hit) : value;
  };
  switch (key) {
    case 'from':
      return `From ${value.split('-').reverse().join('/')}`;
    case 'to':
      return `To ${value.split('-').reverse().join('/')}`;
    case 'site':
      return find(choices?.sites, (s) => s.name);
    case 'building':
      return find(choices?.buildings, (b) => b.name);
    case 'category':
      return find(choices?.categories, (c) => c.label);
    case 'team':
      return find(choices?.teams, (t) => t.name);
    case 'status':
      return value === 'open' ? 'Open' : value === 'done' ? 'Done' : STATUS_LABEL[value as Status] ?? value;
    case 'priority':
      return value.split(',').join(', ');
    case 'source':
      return value === 'legacy' ? 'Old form' : 'RMG Desk';
    case 'assignee':
      return value === 'me' ? 'Assigned to me' : value === 'none' ? 'Unassigned' : `Assignee ${value}`;
    case 'department':
      return `Department: ${value}`;
    case 'requester':
      return `Requester: ${value}`;
    default:
      return value;
  }
}

export default function RequestsPage() {
  return (
    <Suspense fallback={<p className="text-stone-500">Loading…</p>}>
      <RequestsTable />
    </Suspense>
  );
}
