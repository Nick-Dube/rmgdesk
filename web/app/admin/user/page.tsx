'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { ROLE_LABEL, isAdmin, shortDate, when } from '@/lib/format';
import type { AdminOptions, AdminUser, AuditEntry } from '@/lib/types';
import { useMe } from '@/components/MeContext';
import { PrimaryButton, Sheet } from '@/components/Sheet';
import { TeamPicker, UserStatus } from '@/components/admin/People';
import { changes } from '@/components/admin/AuditLog';

type Detail = { user: AdminUser; tickets: { raised: number; assignedOpen: number }; history: AuditEntry[] };
type StatusAction = 'suspend' | 'reactivate' | 'offboard' | 'reset-mfa' | 'resend-invite';

const CONFIRM: Record<StatusAction, { title: string; body: string; button: string; tone: 'navy' | 'red' }> = {
  suspend: { title: 'Suspend access?', body: 'They are signed out everywhere and cannot sign in until you reactivate them. Their teams and requests stay as they are.', button: 'Suspend', tone: 'red' },
  reactivate: { title: 'Reactivate?', body: 'They can sign in again with their existing password and two-step verification.', button: 'Reactivate', tone: 'navy' },
  offboard: { title: 'Offboard this person?', body: 'For leavers. They are signed out everywhere, cannot sign in, are removed from their teams, and their open requests are unassigned so the team can pick them up. Their history is kept.', button: 'Offboard', tone: 'red' },
  'reset-mfa': { title: 'Reset two-step verification?', body: 'Use this when someone has a new phone. They are signed out, and set up their authenticator app or text messages again at the next sign-in.', button: 'Reset', tone: 'navy' },
  'resend-invite': { title: 'Send the invitation again?', body: 'They receive a new temporary password, valid for 7 days.', button: 'Send', tone: 'navy' },
};

function UserView() {
  const id = useSearchParams().get('id');
  const me = useMe();
  const [data, setData] = useState<Detail | null>(null);
  const [options, setOptions] = useState<AdminOptions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<StatusAction | null>(null);
  const [busy, setBusy] = useState(false);

  // Editable fields
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [organisationId, setOrganisationId] = useState('');
  const [role, setRole] = useState('');
  const [teams, setTeams] = useState<number[]>([]);
  const [notifyMode, setNotifyMode] = useState('instant');
  const [saveError, setSaveError] = useState<string | null>(null);

  const fill = (d: Detail) => {
    setData(d);
    setFullName(d.user.fullName);
    setPhone(d.user.phone ?? '');
    setOrganisationId(String(d.user.organisation.id));
    setRole(d.user.role);
    setTeams(d.user.teams.map((t) => t.id));
    setNotifyMode(d.user.notifyMode);
  };

  const load = useCallback(() => {
    if (!id) return;
    api<Detail>(`/admin/users/${id}`).then(fill).catch((e) => setError(e.message));
  }, [id]);

  useEffect(() => {
    if (!isAdmin(me?.role)) return;
    load();
    api<AdminOptions>('/admin/options').then(setOptions).catch(() => {});
  }, [load, me?.role]);

  if (me && !isAdmin(me.role)) return <p>The admin console is for RMG and Vertex superusers.</p>;
  if (error) return <p className="field-error">{error}</p>;
  if (!data || !options) return <p className="text-stone-500">Loading…</p>;
  const u = data.user;
  const self = me?.id === u.id;
  const vertexOnly = me?.role !== 'vertex_superuser' && (u.organisation.code === 'VERTEX' || u.role.startsWith('vertex'));
  const dirty =
    fullName !== u.fullName ||
    phone !== (u.phone ?? '') ||
    organisationId !== String(u.organisation.id) ||
    role !== u.role ||
    notifyMode !== u.notifyMode ||
    JSON.stringify([...teams].sort()) !== JSON.stringify(u.teams.map((t) => t.id).sort());

  async function save() {
    setBusy(true);
    setSaveError(null);
    try {
      await api(`/admin/users/${u.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          fullName,
          phone,
          organisationId: Number(organisationId),
          role,
          notifyMode,
          serviceLineIds: ['agent', 'lead'].includes(role) ? teams : [],
        }),
      });
      setNotice('Saved. It applies from their next click; no need for them to sign out.');
      load();
    } catch (e) {
      const err = e as ApiError;
      setSaveError(err.details?.length ? err.details.map((d) => d.message).join(' ') : err.message);
    } finally {
      setBusy(false);
    }
  }

  async function runStatus(action: StatusAction) {
    setBusy(true);
    try {
      const r = await api<{ message: string }>(`/admin/users/${u.id}/${action}`, { method: 'POST' });
      setNotice(r.message);
      setConfirming(null);
      load();
    } catch (e) {
      setNotice(null);
      setSaveError((e as Error).message);
      setConfirming(null);
    } finally {
      setBusy(false);
    }
  }

  const orgs = options.organisations.some((o) => o.id === u.organisation.id) ? options.organisations : [...options.organisations, { ...u.organisation, type: '' }];
  const roles = options.roles.some((r) => r.code === u.role) ? options.roles : [...options.roles, { code: u.role, label: ROLE_LABEL[u.role] ?? u.role, description: '' }];

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/?tab=people" className="text-sm text-stone-500 hover:underline">← People</Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{u.fullName}</h1>
          <UserStatus status={u.status} />
        </div>
        <p className="text-stone-600">
          {u.email} · {u.organisation.name}
        </p>
      </div>

      {notice && <p className="rounded-xl bg-emerald-50 px-4 py-3 text-emerald-900 ring-1 ring-emerald-200">{notice}</p>}
      {vertexOnly && <p className="rounded-xl bg-amber-50 px-4 py-3 text-amber-950 ring-1 ring-amber-200">Vertex people are managed by Vertex superusers. You can view but not change this account.</p>}

      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <section className="space-y-4 rounded-2xl bg-white p-5 ring-1 ring-stone-200">
          <h2 className="font-semibold">Details and access</h2>
          <fieldset disabled={vertexOnly} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="u-name" className="field-label">Full name</label>
                <input id="u-name" className="field-input" value={fullName} onChange={(e) => setFullName(e.target.value)} />
              </div>
              <div>
                <label htmlFor="u-phone" className="field-label">Phone</label>
                <input id="u-phone" className="field-input" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
              <div>
                <label htmlFor="u-org" className="field-label">Organisation</label>
                <select id="u-org" disabled={self} className="field-input disabled:bg-stone-50" value={organisationId} onChange={(e) => setOrganisationId(e.target.value)}>
                  {orgs.map((o) => (
                    <option key={o.id} value={o.id}>{o.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="u-role" className="field-label">Role</label>
                <select id="u-role" disabled={self} className="field-input disabled:bg-stone-50" value={role} onChange={(e) => setRole(e.target.value)}>
                  {roles.map((r) => (
                    <option key={r.code} value={r.code}>{r.label}</option>
                  ))}
                </select>
                {self && <p className="field-hint">You cannot change your own role.</p>}
              </div>
            </div>
            <div>
              <p className="field-label">Teams</p>
              <TeamPicker options={options} role={role} value={teams} onChange={setTeams} />
            </div>
            <div>
              <label htmlFor="u-notify" className="field-label">Emails when assigned</label>
              <select id="u-notify" className="field-input sm:w-60" value={notifyMode} onChange={(e) => setNotifyMode(e.target.value)}>
                <option value="instant">Straight away</option>
                <option value="off">Off</option>
              </select>
            </div>
            {saveError && <p className="field-error">{saveError}</p>}
            <div className="sm:w-48">
              <PrimaryButton type="button" onClick={save} disabled={busy || !dirty || (['agent', 'lead'].includes(role) && !teams.length)}>
                {busy ? 'Saving…' : 'Save changes'}
              </PrimaryButton>
            </div>
          </fieldset>
        </section>

        <aside className="h-fit space-y-4">
          <div className="space-y-2 rounded-2xl bg-white p-5 text-sm ring-1 ring-stone-200">
            <Fact label="Last sign-in" value={u.lastSignInAt ? when(u.lastSignInAt) : u.hasSignedIn ? 'Over 15 minutes ago' : 'Not yet'} />
            {u.invitedBy && <Fact label="Invited" value={`${shortDate(u.invitedAt)} by ${u.invitedBy}`} />}
            <Fact label="Account created" value={shortDate(u.createdAt)} />
            <Fact label="Requests raised" value={String(data.tickets.raised)} />
            <Fact label="Open requests assigned" value={String(data.tickets.assignedOpen)} />
          </div>
          {!vertexOnly && (
            <div className="space-y-2 rounded-2xl bg-white p-4 ring-1 ring-stone-200">
              {u.status === 'invited' && <Action onClick={() => setConfirming('resend-invite')}>Send the invitation again</Action>}
              {u.hasSignedIn && (u.status === 'active' || u.status === 'invited') && <Action onClick={() => setConfirming('reset-mfa')}>Reset two-step verification</Action>}
              {(u.status === 'suspended' || u.status === 'disabled') && <Action onClick={() => setConfirming('reactivate')}>Reactivate</Action>}
              {!self && (u.status === 'active' || u.status === 'invited') && (
                <>
                  <Action tone="red" onClick={() => setConfirming('suspend')}>Suspend</Action>
                  <Action tone="red" onClick={() => setConfirming('offboard')}>Offboard (leaver)</Action>
                </>
              )}
              {!self && u.status === 'suspended' && <Action tone="red" onClick={() => setConfirming('offboard')}>Offboard (leaver)</Action>}
            </div>
          )}
        </aside>
      </div>

      {data.history.length > 0 && (
        <section>
          <h2 className="mb-3 font-semibold">History</h2>
          <ol className="divide-y divide-stone-200 overflow-hidden rounded-2xl bg-white ring-1 ring-stone-200">
            {data.history.map((h) => {
              const diff = h.action === 'user.invite' ? [] : changes(h.beforeData, h.afterData);
              return (
                <li key={h.id} className="px-4 py-3 text-sm">
                  <p>
                    <span className="font-medium">{h.actorName ?? 'System'}</span> · {h.action.replace('user.', '').replace('-', ' ')}
                    <span className="text-stone-400"> · {when(h.createdAt)}</span>
                  </p>
                  {diff.length > 0 && <p className="mt-1 text-xs text-stone-600">{diff.join(' · ')}</p>}
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {confirming && (
        <Sheet title={CONFIRM[confirming].title} onClose={() => setConfirming(null)}>
          <p className="text-stone-700">{CONFIRM[confirming].body}</p>
          {confirming === 'offboard' && data.tickets.assignedOpen > 0 && (
            <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-950">{data.tickets.assignedOpen} open request(s) will be unassigned.</p>
          )}
          <div className="mt-5">
            <PrimaryButton type="button" tone={CONFIRM[confirming].tone} disabled={busy} onClick={() => runStatus(confirming)}>
              {busy ? 'Working…' : CONFIRM[confirming].button}
            </PrimaryButton>
          </div>
        </Sheet>
      )}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-stone-500">{label}</span>
      <span className="text-right font-medium text-stone-900">{value}</span>
    </div>
  );
}

function Action({ children, onClick, tone }: { children: React.ReactNode; onClick: () => void; tone?: 'red' }) {
  return (
    <button onClick={onClick} className={`w-full rounded-xl px-3 py-2.5 text-left text-sm font-medium ring-1 ring-stone-200 hover:bg-stone-50 ${tone === 'red' ? 'text-rose-700' : 'text-stone-800'}`}>
      {children}
    </button>
  );
}

export default function AdminUserPage() {
  return (
    <Suspense fallback={<p className="text-stone-500">Loading…</p>}>
      <UserView />
    </Suspense>
  );
}
