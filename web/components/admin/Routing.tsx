'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { shortDate } from '@/lib/format';
import type { AdminOptions, RoutingRule } from '@/lib/types';
import { PrimaryButton, Sheet } from '@/components/Sheet';

/** Who receives each category. Editing a rule keeps the old one for reports and history. */
export function Routing({ options }: { options: AdminOptions }) {
  const [rules, setRules] = useState<RoutingRule[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [team, setTeam] = useState('');
  const [editing, setEditing] = useState<RoutingRule | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    api<{ rules: RoutingRule[] }>('/admin/routing').then((r) => setRules(r.rules)).catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  const shown = useMemo(
    () =>
      (rules ?? []).filter(
        (r) =>
          (!team || String(r.serviceLineId) === team) &&
          (!filter || `${r.category} ${r.serviceLine} ${r.recipients.map((x) => x.email).join(' ')}`.toLowerCase().includes(filter.toLowerCase())),
      ),
    [rules, filter, team],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <input className="field-input min-w-48 flex-1 sm:max-w-xs" placeholder="Search category or email" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Search routing" />
        <select className="field-input w-auto" value={team} onChange={(e) => setTeam(e.target.value)} aria-label="Team">
          <option value="">All teams</option>
          {options.serviceLines.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>
      <p className="text-sm text-stone-600">
        New requests go to the team and email recipients below. Categories marked <Evo /> also go to MRI Evolution, which sends its own emails.
      </p>
      {notice && <p className="rounded-xl bg-emerald-50 px-4 py-3 text-emerald-900 ring-1 ring-emerald-200">{notice}</p>}
      {error && <p className="field-error">{error}</p>}
      {!rules && !error && <p className="text-stone-500">Loading…</p>}
      <ul className="divide-y divide-stone-200 overflow-hidden rounded-2xl bg-white ring-1 ring-stone-200">
        {shown.map((r) => (
          <li key={`${r.categoryId}-${r.ruleId ?? 'none'}`} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:gap-4">
            <div className="sm:w-64">
              <p className="font-medium">
                {r.category} {r.isEvolutionLinked && <Evo />}
              </p>
              {r.site && <p className="text-xs text-stone-500">{r.site} only</p>}
            </div>
            <div className="min-w-0 flex-1 text-sm">
              {r.ruleId ? (
                <>
                  <p className="text-stone-800">{r.serviceLine}</p>
                  <p className="mt-0.5 text-stone-500">
                    {r.recipients.map((x, i) => (
                      <span key={x.email + i} className={x.inactive ? 'text-rose-700 line-through' : ''} title={x.inactive ? 'This person has left or is suspended' : undefined}>
                        {i > 0 && ', '}
                        {x.email}
                        {x.kind === 'cc' && ' (cc)'}
                      </span>
                    ))}
                  </p>
                </>
              ) : (
                <p className="font-medium text-rose-700">Not routed: requests go to the Vertex helpdesk to triage.</p>
              )}
            </div>
            <button onClick={() => setEditing(r)} className="self-start rounded-lg px-3 py-1.5 text-sm font-medium text-[#0b2545] ring-1 ring-stone-300 hover:bg-stone-50">
              {r.ruleId ? 'Edit' : 'Route it'}
            </button>
          </li>
        ))}
      </ul>
      {editing && (
        <RuleSheet
          rule={editing}
          options={options}
          onClose={() => setEditing(null)}
          onDone={() => {
            setNotice(`Routing for ${editing.category} saved. New requests use it straight away.`);
            setEditing(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function Evo() {
  return <span className="ml-1 inline-flex rounded-md bg-indigo-100 px-1.5 py-0.5 align-middle text-[10px] font-semibold uppercase tracking-wide text-indigo-900">Evolution</span>;
}

function RuleSheet({ rule, options, onClose, onDone }: { rule: RoutingRule; options: AdminOptions; onClose: () => void; onDone: () => void }) {
  const [serviceLineId, setServiceLineId] = useState(String(rule.serviceLineId ?? ''));
  const [to, setTo] = useState(rule.recipients.filter((r) => r.kind === 'to').map((r) => r.email).join('\n'));
  const [cc, setCc] = useState(rule.recipients.filter((r) => r.kind === 'cc').map((r) => r.email).join('\n'));
  const [notes, setNotes] = useState(rule.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const split = (s: string) => s.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);

  async function submit() {
    setBusy(true);
    setError(null);
    const recipients = [...split(to).map((email) => ({ email, kind: 'to' })), ...split(cc).map((email) => ({ email, kind: 'cc' }))];
    const body = { serviceLineId: Number(serviceLineId), recipients, notes };
    try {
      if (rule.ruleId) await api(`/admin/routing/rules/${rule.ruleId}`, { method: 'PUT', body: JSON.stringify(body) });
      else await api('/admin/routing/rules', { method: 'POST', body: JSON.stringify({ ...body, categoryId: rule.categoryId, siteId: rule.siteId }) });
      onDone();
    } catch (e) {
      const err = e as ApiError;
      setError(err.details?.length ? err.details.map((d) => d.message).join(' ') : err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title={`Routing: ${rule.category}`} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div>
          <label htmlFor="rule-team" className="field-label">Team</label>
          <select id="rule-team" required className="field-input" value={serviceLineId} onChange={(e) => setServiceLineId(e.target.value)}>
            <option value="">Choose…</option>
            {options.serviceLines.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.isEvolutionLinked ? ' (MRI Evolution)' : ''}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="rule-to" className="field-label">Email to</label>
          <textarea id="rule-to" rows={3} className="field-input font-mono text-sm" value={to} onChange={(e) => setTo(e.target.value)} placeholder="One address per line" />
        </div>
        <div>
          <label htmlFor="rule-cc" className="field-label">Copy to (cc)</label>
          <textarea id="rule-cc" rows={2} className="field-input font-mono text-sm" value={cc} onChange={(e) => setCc(e.target.value)} />
        </div>
        <div>
          <label htmlFor="rule-notes" className="field-label">Notes (optional)</label>
          <input id="rule-notes" className="field-input" maxLength={255} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        {rule.effectiveFrom && <p className="text-xs text-stone-500">Current rule since {shortDate(rule.effectiveFrom)}. Saving starts a new rule today; past requests keep the old one.</p>}
        {error && <p className="field-error">{error}</p>}
        <PrimaryButton disabled={busy || !serviceLineId || !split(to).length}>{busy ? 'Saving…' : 'Save routing'}</PrimaryButton>
      </form>
    </Sheet>
  );
}
