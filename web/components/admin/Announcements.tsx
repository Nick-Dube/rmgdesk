'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { when } from '@/lib/format';
import type { AdminOptions, Announcement } from '@/lib/types';
import { PrimaryButton, Sheet } from '@/components/Sheet';

/** Banners on the home page and request form: lift out of service, planned shutdowns, known problems. */
export function Announcements({ options }: { options: AdminOptions }) {
  const [rows, setRows] = useState<Announcement[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Announcement | 'new' | null>(null);

  const load = useCallback(() => {
    api<{ announcements: Announcement[] }>('/admin/announcements').then((r) => setRows(r.announcements)).catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  async function remove(a: Announcement) {
    if (!window.confirm('Delete this announcement?')) return;
    try {
      await api(`/admin/announcements/${a.id}`, { method: 'DELETE' });
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-stone-600">Everyone sees site-wide messages on the home page. Messages for a site or building show on the request form when it is chosen, so people don&apos;t report known problems twice.</p>
        <button onClick={() => setEditing('new')} className="rounded-xl bg-[#0b2545] px-4 py-2.5 font-semibold text-white hover:bg-[#08182e]">
          New announcement
        </button>
      </div>
      {error && <p className="field-error">{error}</p>}
      {!rows && !error && <p className="text-stone-500">Loading…</p>}
      {rows && !rows.length && <p className="rounded-2xl bg-white p-6 text-center text-stone-500 ring-1 ring-stone-200">No announcements.</p>}
      <ul className="space-y-2">
        {rows?.map((a) => (
          <li key={a.id} className={`rounded-2xl bg-white p-4 ring-1 ${a.live ? 'border-l-4 border-amber-500 ring-stone-200' : 'opacity-70 ring-stone-200'}`}>
            <div className="flex flex-wrap items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{a.message}</p>
                <p className="mt-1 text-xs text-stone-500">
                  {a.live ? 'Showing now' : new Date(a.startsAt) > new Date() ? `Starts ${when(a.startsAt)}` : 'Ended'} · {a.building ?? a.site ?? 'Everywhere'}
                  {a.endsAt && ` · until ${when(a.endsAt)}`}
                  {a.createdBy && ` · by ${a.createdBy}`}
                </p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setEditing(a)} className="rounded-lg px-3 py-1.5 text-sm font-medium text-[#0b2545] ring-1 ring-stone-300 hover:bg-stone-50">Edit</button>
                <button onClick={() => remove(a)} className="rounded-lg px-3 py-1.5 text-sm font-medium text-rose-700 hover:bg-rose-50">Delete</button>
              </div>
            </div>
          </li>
        ))}
      </ul>
      {editing && (
        <AnnouncementSheet
          options={options}
          existing={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </div>
  );
}

/** <input type="datetime-local"> works in local time; the API stores UTC. */
const toLocalInput = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

function AnnouncementSheet({ options, existing, onClose, onDone }: { options: AdminOptions; existing: Announcement | null; onClose: () => void; onDone: () => void }) {
  const [message, setMessage] = useState(existing?.message ?? '');
  const [place, setPlace] = useState(existing?.buildingId ? `b${existing.buildingId}` : existing?.siteId ? `s${existing.siteId}` : '');
  const [startsAt, setStartsAt] = useState(toLocalInput(existing?.startsAt ?? null));
  const [endsAt, setEndsAt] = useState(toLocalInput(existing?.endsAt ?? null));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    const body = {
      message,
      siteId: place.startsWith('s') ? Number(place.slice(1)) : null,
      buildingId: place.startsWith('b') ? Number(place.slice(1)) : null,
      ...(startsAt ? { startsAt: new Date(startsAt).toISOString() } : {}),
      endsAt: endsAt ? new Date(endsAt).toISOString() : null,
    };
    try {
      await api(existing ? `/admin/announcements/${existing.id}` : '/admin/announcements', { method: existing ? 'PATCH' : 'POST', body: JSON.stringify(body) });
      onDone();
    } catch (e) {
      const err = e as ApiError;
      setError(err.details?.length ? err.details.map((d) => d.message).join(' ') : err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title={existing ? 'Edit announcement' : 'New announcement'} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div>
          <label htmlFor="ann-msg" className="field-label">Message</label>
          <textarea id="ann-msg" rows={3} maxLength={500} autoFocus className="field-input" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="e.g. Lift 2 in the Sammy Ofer Wing is out of service. Engineers are on site; no need to report it." />
        </div>
        <div>
          <label htmlFor="ann-place" className="field-label">Where</label>
          <select id="ann-place" className="field-input" value={place} onChange={(e) => setPlace(e.target.value)}>
            <option value="">Everywhere</option>
            {options.sites.map((s) => (
              <optgroup key={s.id} label={s.name}>
                <option value={`s${s.id}`}>All of {s.name}</option>
                {options.buildings
                  .filter((b) => b.siteId === s.id)
                  .map((b) => (
                    <option key={b.id} value={`b${b.id}`}>{b.name}</option>
                  ))}
              </optgroup>
            ))}
          </select>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="ann-start" className="field-label">From</label>
            <input id="ann-start" type="datetime-local" className="field-input" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
            <p className="field-hint">Leave empty to start now.</p>
          </div>
          <div>
            <label htmlFor="ann-end" className="field-label">Until</label>
            <input id="ann-end" type="datetime-local" className="field-input" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
            <p className="field-hint">Leave empty to keep it until you delete it.</p>
          </div>
        </div>
        {error && <p className="field-error">{error}</p>}
        <PrimaryButton disabled={busy || message.trim().length < 5}>{busy ? 'Saving…' : 'Save'}</PrimaryButton>
      </form>
    </Sheet>
  );
}
