'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { when } from '@/lib/format';
import type { AuditEntry } from '@/lib/types';

const ACTIONS: Record<string, string> = {
  'user.invite': 'invited',
  'user.update': 'changed',
  'user.suspend': 'suspended',
  'user.reactivate': 'reactivated',
  'user.offboard': 'offboarded',
  'user.reset-mfa': 'reset two-step verification for',
  'user.resend-invite': 're-sent the invitation to',
  'routing.create': 'routed',
  'routing.update': 'changed the routing for',
  'announcement.create': 'posted an announcement',
  'announcement.update': 'edited an announcement',
  'announcement.delete': 'deleted an announcement',
};

const parse = (v: unknown): Record<string, unknown> | null => {
  if (!v) return null;
  if (typeof v === 'string') {
    try {
      return JSON.parse(v);
    } catch {
      return null;
    }
  }
  return v as Record<string, unknown>;
};

/** "role: requester → lead" for the fields that changed. */
export function changes(before: unknown, after: unknown): string[] {
  const b = parse(before) ?? {};
  const a = parse(after) ?? {};
  const show = (v: unknown) => (Array.isArray(v) ? v.join(', ') || 'none' : v === null || v === undefined || v === '' ? 'none' : String(v));
  return Object.keys(a)
    .filter((k) => !['ruleId', 'effective_from', 'effective_to', 'category_id', 'site_id'].includes(k))
    .filter((k) => JSON.stringify(b[k]) !== JSON.stringify(a[k]))
    .map((k) => {
      if (k === 'recipients') {
        const list = (x: unknown) => (Array.isArray(x) ? x.map((r) => `${r.email}${r.kind === 'cc' ? ' (cc)' : ''}`).join(', ') : '');
        return `recipients: ${list(b[k]) || 'none'} → ${list(a[k])}`;
      }
      return k in b ? `${k}: ${show(b[k])} → ${show(a[k])}` : `${k}: ${show(a[k])}`;
    });
}

export function AuditLog() {
  const [rows, setRows] = useState<AuditEntry[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [entity, setEntity] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (before?: number) => {
      setLoading(true);
      try {
        const qs = new URLSearchParams({ ...(entity ? { entity } : {}), ...(before ? { before: String(before) } : {}) });
        const r = await api<{ entries: AuditEntry[]; next: number | null }>(`/admin/audit?${qs}`);
        setRows((prev) => (before ? [...prev, ...r.entries] : r.entries));
        setNext(r.next);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [entity],
  );
  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-4">
      <select className="field-input w-auto" value={entity} onChange={(e) => setEntity(e.target.value)} aria-label="Show">
        <option value="">Everything</option>
        <option value="user">People</option>
        <option value="routing_rule">Routing</option>
        <option value="announcement">Announcements</option>
      </select>
      {error && <p className="field-error">{error}</p>}
      <ol className="divide-y divide-stone-200 overflow-hidden rounded-2xl bg-white ring-1 ring-stone-200">
        {rows.map((e) => {
          const diff = e.action === 'user.invite' || e.action.startsWith('announcement') ? [] : changes(e.beforeData, e.afterData);
          return (
            <li key={e.id} className="px-4 py-3 text-sm">
              <p>
                <span className="font-medium">{e.actorName ?? 'System'}</span> {ACTIONS[e.action] ?? e.action}{' '}
                {e.entity === 'user' && e.subject ? (
                  <Link href={`/admin/user/?id=${e.entityId}`} className="font-medium text-[#0b2545] underline-offset-2 hover:underline">{e.subject}</Link>
                ) : (
                  e.subject && <span className="font-medium">{e.subject}</span>
                )}
              </p>
              {diff.length > 0 && (
                <ul className="mt-1 space-y-0.5 text-xs text-stone-600">
                  {diff.map((d) => (
                    <li key={d} className="break-words">{d}</li>
                  ))}
                </ul>
              )}
              <p className="mt-1 text-xs text-stone-400">
                {when(e.createdAt)}
                {e.ip ? ` · ${e.ip}` : ''}
              </p>
            </li>
          );
        })}
        {!loading && !rows.length && <li className="px-4 py-6 text-center text-stone-500">Nothing yet.</li>}
      </ol>
      {next && (
        <button onClick={() => load(next)} disabled={loading} className="w-full rounded-xl bg-white py-3 font-medium ring-1 ring-stone-200">
          {loading ? 'Loading…' : 'Show older'}
        </button>
      )}
    </div>
  );
}
