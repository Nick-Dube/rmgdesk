'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { ROLE_LABEL, USER_STATUS, shortDate } from '@/lib/format';
import type { AdminOptions, AdminUserRow } from '@/lib/types';
import { PrimaryButton, Sheet } from '@/components/Sheet';

export function UserStatus({ status }: { status: string }) {
  const s = USER_STATUS[status] ?? { label: status, tone: 'bg-stone-100 ring-stone-200' };
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${s.tone}`}>{s.label}</span>;
}

export function People({ options }: { options: AdminOptions }) {
  const [rows, setRows] = useState<AdminUserRow[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('any');
  const [role, setRole] = useState('');
  const [org, setOrg] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    const qs = new URLSearchParams({ status, ...(q ? { q } : {}), ...(role ? { role } : {}), ...(org ? { org } : {}) });
    api<{ users: AdminUserRow[]; counts: Record<string, number> }>(`/admin/users?${qs}`)
      .then((r) => {
        setRows(r.users);
        setCounts(r.counts);
      })
      .catch((e) => setError(e.message));
  }, [q, status, role, org]);

  useEffect(() => {
    const t = setTimeout(load, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input className="field-input min-w-48 flex-1 sm:max-w-xs" placeholder="Search name or email" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search people" />
        <select className="field-input w-auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="any">Everyone ({Object.values(counts).reduce((a, b) => a + b, 0)})</option>
          {Object.entries(USER_STATUS).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label} ({counts[k] ?? 0})
            </option>
          ))}
        </select>
        <select className="field-input w-auto" value={role} onChange={(e) => setRole(e.target.value)} aria-label="Role">
          <option value="">Any role</option>
          {Object.entries(ROLE_LABEL).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <select className="field-input w-auto" value={org} onChange={(e) => setOrg(e.target.value)} aria-label="Organisation">
          <option value="">Any organisation</option>
          {options.organisations.map((o) => (
            <option key={o.id} value={o.id}>{o.name}</option>
          ))}
        </select>
        <button onClick={() => setInviting(true)} className="ml-auto rounded-xl bg-[#0b2545] px-4 py-2.5 font-semibold text-white hover:bg-[#08182e]">
          Invite someone
        </button>
      </div>

      {notice && <p className="rounded-xl bg-emerald-50 px-4 py-3 text-emerald-900 ring-1 ring-emerald-200">{notice}</p>}
      {error && <p className="field-error">{error}</p>}
      {!rows && !error && <p className="text-stone-500">Loading…</p>}

      {rows && (
        <div className="overflow-hidden rounded-2xl bg-white ring-1 ring-stone-200">
          <table className="w-full text-left text-sm">
            <thead className="hidden bg-stone-50 text-xs uppercase tracking-wide text-stone-500 md:table-header-group">
              <tr>
                <th className="px-4 py-3 font-medium">Person</th>
                <th className="px-4 py-3 font-medium">Organisation</th>
                <th className="px-4 py-3 font-medium">Role and teams</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Last sign-in</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-200">
              {rows.map((u) => (
                <tr key={u.id} className="relative block hover:bg-stone-50 md:table-row">
                  <td className="block px-4 pt-3 md:table-cell md:py-3">
                    <Link href={`/admin/user/?id=${u.id}`} className="font-medium text-stone-900 after:absolute after:inset-0">
                      {u.fullName}
                    </Link>
                    <p className="truncate text-stone-500">{u.email}</p>
                  </td>
                  <td className="block px-4 text-stone-600 md:table-cell md:py-3">{u.organisation}</td>
                  <td className="block px-4 md:table-cell md:py-3">
                    <span className="font-medium">{ROLE_LABEL[u.role] ?? u.role}</span>
                    {u.teams && <p className="text-xs text-stone-500">{u.teams}</p>}
                  </td>
                  <td className="inline-block px-4 py-2 md:table-cell md:py-3">
                    <UserStatus status={u.status} />
                  </td>
                  <td className="inline-block px-4 pb-3 text-stone-500 md:table-cell md:py-3">
                    {u.lastSignInAt ? shortDate(u.lastSignInAt) : u.status === 'invited' ? `Invited ${shortDate(u.invitedAt)}` : 'Never'}
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td className="px-4 py-6 text-center text-stone-500" colSpan={5}>Nobody matches.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {inviting && (
        <InviteSheet
          options={options}
          onClose={() => setInviting(false)}
          onDone={(message) => {
            setInviting(false);
            setNotice(message);
            load();
          }}
        />
      )}
    </div>
  );
}

/** Teams a role works for. Only agents and leads are limited to teams; the others see everything. */
export function TeamPicker({ options, role, value, onChange }: { options: AdminOptions; role: string; value: number[]; onChange: (v: number[]) => void }) {
  if (!['agent', 'lead'].includes(role)) {
    return <p className="field-hint">{role === 'requester' ? 'Requesters only see their own requests.' : 'This role sees every request, so no teams are needed.'}</p>;
  }
  return (
    <div className="grid max-h-56 gap-1 overflow-y-auto rounded-xl p-1 ring-1 ring-stone-200 sm:grid-cols-2">
      {options.serviceLines.map((s) => (
        <label key={s.id} className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-stone-50">
          <input
            type="checkbox"
            className="mt-0.5 accent-[#0b2545]"
            checked={value.includes(s.id)}
            onChange={(e) => onChange(e.target.checked ? [...value, s.id] : value.filter((x) => x !== s.id))}
          />
          {s.name}
        </label>
      ))}
    </div>
  );
}

function InviteSheet({ options, onClose, onDone }: { options: AdminOptions; onClose: () => void; onDone: (message: string) => void }) {
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [organisationId, setOrganisationId] = useState('');
  const [role, setRole] = useState('requester');
  const [teams, setTeams] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Suggest the organisation from the email domain.
  useEffect(() => {
    const domain = email.split('@')[1]?.toLowerCase();
    if (!domain || organisationId) return;
    const guess = { 'rmg.co.uk': 'RMG', 'vertex.net': 'VERTEX', 'ocs.com': 'OCS', 'benugo.com': 'BENUGO' }[domain];
    const org = options.organisations.find((o) => o.code === guess);
    if (org) setOrganisationId(String(org.id));
  }, [email, organisationId, options.organisations]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ message: string }>('/admin/users', {
        method: 'POST',
        body: JSON.stringify({ email, fullName, phone, organisationId: Number(organisationId), role, serviceLineIds: ['agent', 'lead'].includes(role) ? teams : [] }),
      });
      onDone(r.message);
    } catch (e) {
      const err = e as ApiError;
      setError(err.details?.length ? err.details.map((d) => d.message).join(' ') : err.message);
    } finally {
      setBusy(false);
    }
  }

  const roleInfo = options.roles.find((r) => r.code === role);
  return (
    <Sheet title="Invite someone" onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label htmlFor="inv-email" className="field-label">Work email</label>
            <input id="inv-email" type="email" required autoFocus className="field-input" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <label htmlFor="inv-name" className="field-label">Full name</label>
            <input id="inv-name" required className="field-input" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div>
            <label htmlFor="inv-phone" className="field-label">Phone (optional)</label>
            <input id="inv-phone" className="field-input" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div>
            <label htmlFor="inv-org" className="field-label">Organisation</label>
            <select id="inv-org" required className="field-input" value={organisationId} onChange={(e) => setOrganisationId(e.target.value)}>
              <option value="">Choose…</option>
              {options.organisations.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="inv-role" className="field-label">Role</label>
            <select id="inv-role" className="field-input" value={role} onChange={(e) => setRole(e.target.value)}>
              {options.roles.map((r) => (
                <option key={r.code} value={r.code}>{r.label}</option>
              ))}
            </select>
          </div>
        </div>
        {roleInfo && <p className="-mt-2 text-sm text-stone-600">{roleInfo.description}</p>}
        <div>
          <p className="field-label">Teams</p>
          <TeamPicker options={options} role={role} value={teams} onChange={setTeams} />
        </div>
        <p className="rounded-xl bg-stone-50 px-3 py-2 text-xs text-stone-600">
          They receive an email with a temporary password (valid 7 days), then choose their own password and set up two-step verification.
        </p>
        {error && <p className="field-error">{error}</p>}
        <PrimaryButton disabled={busy || !email || !fullName || !organisationId || (['agent', 'lead'].includes(role) && !teams.length)}>
          {busy ? 'Sending…' : 'Send invitation'}
        </PrimaryButton>
      </form>
    </Sheet>
  );
}
