'use client';

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { api, ApiError, uploadFile } from '@/lib/api';
import { formatBytes, prepareForUpload } from '@/lib/image';
import { ROOT_CAUSES } from '@/lib/format';
import type { Action, Assignee, Priority, Reference, TicketDetail } from '@/lib/types';
import { PrimaryButton, Sheet } from './Sheet';

type Result = TicketDetail | { moved: true; message: string };

const HOLD_REASONS = [
  'Awaiting parts',
  'Awaiting access',
  'Awaiting contractor',
  'Awaiting quote approval',
  'Awaiting the requester',
  'Planned for a later date',
];

/** The buttons a person sees depend on the actions the API says they may take now. */
export function TicketActions({
  data,
  meId,
  confirm,
  onChange,
  onMoved,
}: {
  data: TicketDetail;
  meId: number;
  confirm: string | null;
  onChange: (d: TicketDetail) => void;
  onMoved: (message: string) => void;
}) {
  const [open, setOpen] = useState<Action | 'assign_me' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const can = (a: Action) => data.actions.includes(a);
  const t = data.ticket;

  // From the "Is it fixed?" email: open the right answer straight away.
  useEffect(() => {
    if (confirm === 'yes' && can('confirm_fixed')) setOpen('confirm_fixed');
    if (confirm === 'no' && can('not_fixed')) setOpen('not_fixed');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirm]);

  async function run(action: Action, input: Record<string, unknown> = {}) {
    setBusy(true);
    setError(null);
    try {
      const res = await api<Result>(`/tickets/${t.id}/actions`, { method: 'POST', body: JSON.stringify({ action, input }) });
      setOpen(null);
      if ('moved' in res) onMoved(res.message);
      else onChange(res);
      return true;
    } catch (e) {
      const err = e as ApiError;
      setError(err.details?.length ? err.details.map((d) => d.message).join(' ') : err.message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  const close = () => {
    setOpen(null);
    setError(null);
  };
  const sheetProps = { busy, error, onClose: close };

  const staff = data.canWork;
  const requesterCanAnswer = can('confirm_fixed') || can('not_fixed');
  if (!data.actions.length) return null;

  return (
    <>
      {requesterCanAnswer && (
        <section className="overflow-hidden rounded-2xl bg-emerald-50 ring-1 ring-emerald-200">
          <div className="p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">Completed</p>
            <h2 className="mt-1 text-lg font-semibold text-emerald-950">Is it fixed?</h2>
            {t.resolutionNote && <p className="mt-2 whitespace-pre-wrap text-emerald-950/80">{t.resolutionNote}</p>}
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <button onClick={() => setOpen('confirm_fixed')} className="rounded-xl bg-emerald-700 px-4 py-3 font-semibold text-white hover:bg-emerald-800">
                Yes, it&apos;s fixed
              </button>
              <button onClick={() => setOpen('not_fixed')} className="rounded-xl bg-white px-4 py-3 font-semibold text-rose-800 ring-1 ring-rose-200 hover:bg-rose-50">
                No, still a problem
              </button>
            </div>
            <p className="mt-3 text-xs text-emerald-900/70">If we don&apos;t hear from you, it closes automatically after 3 working days.</p>
          </div>
        </section>
      )}

      {staff && (
        <section className="rounded-2xl bg-white p-4 ring-1 ring-stone-200">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-stone-500">Update this request</p>
          <div className="grid grid-cols-2 gap-2">
            {can('acknowledge') && <Btn onClick={() => run('acknowledge')} disabled={busy}>Acknowledge</Btn>}
            {can('assign') && t.assignee?.id !== meId && (
              <Btn onClick={() => run('assign', { assigneeId: meId })} disabled={busy}>
                Assign to me
              </Btn>
            )}
            {can('assign') && <Btn onClick={() => setOpen('assign')}>{t.assignee ? 'Reassign…' : 'Assign…'}</Btn>}
            {can('attending') && t.status !== 'attending' && <Btn onClick={() => setOpen('attending')}>Engineer attending</Btn>}
            {can('made_safe') && <Btn onClick={() => setOpen('made_safe')}>Made safe</Btn>}
            {can('resume') && <Btn onClick={() => setOpen('resume')}>Resume work</Btn>}
            {can('reopen') && <Btn onClick={() => setOpen('reopen')}>Reopen</Btn>}
            {can('hold') && <Btn onClick={() => setOpen('hold')}>Put on hold</Btn>}
            {can('priority') && <Btn onClick={() => setOpen('priority')}>Change priority</Btn>}
            {can('recategorise') && <Btn onClick={() => setOpen('recategorise')}>Change category</Btn>}
          </div>
          {can('resolve') && (
            <button onClick={() => setOpen('resolve')} className="mt-2 w-full rounded-xl bg-emerald-700 px-4 py-3 font-semibold text-white hover:bg-emerald-800">
              Complete
            </button>
          )}
          {can('cancel') && (
            <button onClick={() => setOpen('cancel')} className="mt-2 w-full rounded-xl px-4 py-2 text-sm font-medium text-rose-700 hover:bg-rose-50">
              Cancel request
            </button>
          )}
          {error && !open && <p className="field-error">{error}</p>}
        </section>
      )}

      {can('withdraw') && !staff && (
        <button onClick={() => setOpen('withdraw')} className="text-sm font-medium text-stone-600 underline-offset-4 hover:underline">
          Withdraw this request
        </button>
      )}

      {open === 'confirm_fixed' && <ConfirmSheet {...sheetProps} onSubmit={(i) => run('confirm_fixed', i)} />}
      {open === 'not_fixed' && (
        <TextSheet {...sheetProps} title="What is still wrong?" label="Tell the team what's still wrong" required tone="red" submit="Send it back to the team" field="comment" onSubmit={(i) => run('not_fixed', i)} />
      )}
      {open === 'withdraw' && (
        <TextSheet {...sheetProps} title="Withdraw this request?" label="Reason (optional)" submit="Withdraw request" tone="red" field="reason" onSubmit={(i) => run('withdraw', i)} />
      )}
      {open === 'attending' && (
        <TextSheet {...sheetProps} title="Engineer attending" label="Note (optional)" placeholder="Who is attending, expected time…" submit="Save" field="note" onSubmit={(i) => run('attending', i)} />
      )}
      {open === 'made_safe' && (
        <TextSheet {...sheetProps} title="Made safe" label="What was done to make it safe? (optional)" submit="Save" field="note" onSubmit={(i) => run('made_safe', i)} />
      )}
      {open === 'resume' && <TextSheet {...sheetProps} title="Resume work" label="Note (optional)" submit="Resume" field="note" onSubmit={(i) => run('resume', i)} />}
      {open === 'reopen' && <TextSheet {...sheetProps} title="Reopen this request" label="Why is it being reopened?" required submit="Reopen" field="reason" onSubmit={(i) => run('reopen', i)} />}
      {open === 'hold' && <HoldSheet {...sheetProps} onSubmit={(i) => run('hold', i)} />}
      {open === 'assign' && <AssignSheet {...sheetProps} ticketId={t.id} current={t.assignee?.id ?? null} onSubmit={(i) => run('assign', i)} />}
      {open === 'priority' && <PrioritySheet {...sheetProps} current={t.priority} onSubmit={(i) => run('priority', i)} />}
      {open === 'recategorise' && <CategorySheet {...sheetProps} current={t.categoryId} onSubmit={(i) => run('recategorise', i)} />}
      {open === 'resolve' && <ResolveSheet {...sheetProps} isRequesterEmailed={!t.isEvolutionLinked} onSubmit={(i) => run('resolve', i)} />}
      {open === 'cancel' && <CancelSheet {...sheetProps} onSubmit={(i) => run('cancel', i)} />}
    </>
  );
}

function Btn({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} className="rounded-xl bg-stone-50 px-3 py-2.5 text-sm font-medium text-stone-800 ring-1 ring-stone-200 hover:bg-stone-100 disabled:opacity-50">
      {children}
    </button>
  );
}

type SheetBase = { busy: boolean; error: string | null; onClose: () => void; onSubmit: (input: Record<string, unknown>) => Promise<boolean> };

function Form({ onSubmit, children }: { onSubmit: () => void; children: ReactNode }) {
  return (
    <form
      className="space-y-4"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      {children}
    </form>
  );
}

function TextSheet({
  title,
  label,
  placeholder,
  required,
  submit,
  tone,
  field,
  busy,
  error,
  onClose,
  onSubmit,
}: SheetBase & { title: string; label: string; placeholder?: string; required?: boolean; submit: string; tone?: 'navy' | 'red'; field: string }) {
  const [text, setText] = useState('');
  return (
    <Sheet title={title} onClose={onClose}>
      <Form onSubmit={() => onSubmit({ [field]: text })}>
        <div>
          <label htmlFor="sheet-text" className="field-label">{label}</label>
          <textarea id="sheet-text" rows={4} autoFocus className="field-input" value={text} placeholder={placeholder} onChange={(e) => setText(e.target.value)} />
        </div>
        {error && <p className="field-error">{error}</p>}
        <PrimaryButton tone={tone} disabled={busy || (required && !text.trim())}>{busy ? 'Saving…' : submit}</PrimaryButton>
      </Form>
    </Sheet>
  );
}

function ConfirmSheet({ busy, error, onClose, onSubmit }: SheetBase) {
  const [rating, setRating] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const words = ['', 'Poor', 'Could be better', 'OK', 'Good', 'Excellent'];
  return (
    <Sheet title="Great, glad it's fixed" onClose={onClose}>
      <Form onSubmit={() => onSubmit({ rating, comment })}>
        <div>
          <p className="field-label">How did we do? (optional)</p>
          <div className="flex gap-2" role="radiogroup" aria-label="Rating">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={rating === n}
                aria-label={`${n} star${n > 1 ? 's' : ''}: ${words[n]}`}
                onClick={() => setRating(n)}
                className={`text-5xl leading-none transition ${rating && n <= rating ? 'text-amber-500' : 'text-stone-300 hover:text-amber-300'}`}
              >
                ★
              </button>
            ))}
          </div>
          <p className="field-hint h-4">{rating ? words[rating] : ''}</p>
        </div>
        <div>
          <label htmlFor="confirm-comment" className="field-label">Anything to add? (optional)</label>
          <textarea id="confirm-comment" rows={3} className="field-input" value={comment} onChange={(e) => setComment(e.target.value)} />
        </div>
        {error && <p className="field-error">{error}</p>}
        <PrimaryButton tone="green" disabled={busy}>{busy ? 'Closing…' : 'Close the request'}</PrimaryButton>
      </Form>
    </Sheet>
  );
}

function HoldSheet({ busy, error, onClose, onSubmit }: SheetBase) {
  const [reason, setReason] = useState('');
  const [other, setOther] = useState('');
  const [note, setNote] = useState('');
  const value = reason === 'other' ? other : reason;
  return (
    <Sheet title="Put on hold" onClose={onClose}>
      <Form onSubmit={() => onSubmit({ reason: value, note })}>
        <fieldset>
          <legend className="field-label">Why is it on hold?</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {[...HOLD_REASONS, 'other'].map((r) => (
              <label key={r} className={`flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2.5 text-sm ring-1 ${reason === r ? 'bg-[#0b2545]/5 ring-[#0b2545]' : 'ring-stone-200'}`}>
                <input type="radio" name="hold" value={r} checked={reason === r} onChange={() => setReason(r)} className="accent-[#0b2545]" />
                {r === 'other' ? 'Something else' : r}
              </label>
            ))}
          </div>
          {reason === 'other' && <input autoFocus className="field-input mt-2" maxLength={120} placeholder="Reason" value={other} onChange={(e) => setOther(e.target.value)} />}
        </fieldset>
        <div>
          <label htmlFor="hold-note" className="field-label">Note (optional)</label>
          <textarea id="hold-note" rows={2} className="field-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="E.g. part ordered, due Thursday" />
          <p className="field-hint">The requester is emailed the reason and this note.</p>
        </div>
        {error && <p className="field-error">{error}</p>}
        <PrimaryButton disabled={busy || !value.trim()}>{busy ? 'Saving…' : 'Put on hold'}</PrimaryButton>
      </Form>
    </Sheet>
  );
}

function AssignSheet({ ticketId, current, busy, error, onClose, onSubmit }: SheetBase & { ticketId: number; current: number | null }) {
  const [people, setPeople] = useState<Assignee[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pick, setPick] = useState<number | null>(current);
  const [filter, setFilter] = useState('');
  useEffect(() => {
    api<{ assignees: Assignee[] }>(`/tickets/${ticketId}/assignees`).then((r) => setPeople(r.assignees)).catch((e) => setLoadError(e.message));
  }, [ticketId]);
  const shown = (people ?? []).filter((p) => !filter || `${p.name} ${p.organisation}`.toLowerCase().includes(filter.toLowerCase()));
  return (
    <Sheet title="Assign" onClose={onClose}>
      <Form onSubmit={() => onSubmit({ assigneeId: pick })}>
        {loadError && <p className="field-error">{loadError}</p>}
        {!people && !loadError && <p className="text-stone-500">Loading…</p>}
        {people && people.length > 8 && <input className="field-input" placeholder="Search people" value={filter} onChange={(e) => setFilter(e.target.value)} />}
        {people && (
          <ul className="max-h-72 space-y-1 overflow-y-auto">
            {shown.map((p) => (
              <li key={p.id}>
                <label className={`flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 ring-1 ${pick === p.id ? 'bg-[#0b2545]/5 ring-[#0b2545]' : 'ring-transparent hover:bg-stone-50'}`}>
                  <input type="radio" name="assignee" checked={pick === p.id} onChange={() => setPick(p.id)} className="accent-[#0b2545]" />
                  <span className="flex-1">
                    <span className="block font-medium">{p.name}</span>
                    <span className="block text-xs text-stone-500">{p.organisation}</span>
                  </span>
                </label>
              </li>
            ))}
            {current && (
              <li>
                <label className={`flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 ring-1 ${pick === null ? 'bg-stone-100 ring-stone-300' : 'ring-transparent hover:bg-stone-50'}`}>
                  <input type="radio" name="assignee" checked={pick === null} onChange={() => setPick(null)} />
                  <span className="text-stone-600">Nobody (unassign)</span>
                </label>
              </li>
            )}
          </ul>
        )}
        {error && <p className="field-error">{error}</p>}
        <PrimaryButton disabled={busy || pick === current}>{busy ? 'Saving…' : pick ? 'Assign' : 'Unassign'}</PrimaryButton>
      </Form>
    </Sheet>
  );
}

function PrioritySheet({ current, busy, error, onClose, onSubmit }: SheetBase & { current: Priority }) {
  const [priority, setPriority] = useState<Priority>(current);
  const [reason, setReason] = useState('');
  const labels: Record<Priority, string> = { P1: 'P1 - High: health and safety or security risk', P2: 'P2 - Medium: stops normal operation', P3: 'P3 - Low: routine', P4: 'P4 - Planned works' };
  return (
    <Sheet title="Change priority" onClose={onClose}>
      <Form onSubmit={() => onSubmit({ priority, reason })}>
        <div className="space-y-2">
          {(Object.keys(labels) as Priority[]).map((p) => (
            <label key={p} className={`flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-sm ring-1 ${priority === p ? 'bg-[#0b2545]/5 ring-[#0b2545]' : 'ring-stone-200'}`}>
              <input type="radio" name="priority" checked={priority === p} onChange={() => setPriority(p)} className="accent-[#0b2545]" />
              {labels[p]}
            </label>
          ))}
        </div>
        <div>
          <label htmlFor="priority-reason" className="field-label">Reason (optional)</label>
          <input id="priority-reason" className="field-input" value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        {error && <p className="field-error">{error}</p>}
        <PrimaryButton disabled={busy || priority === current}>{busy ? 'Saving…' : 'Change priority'}</PrimaryButton>
      </Form>
    </Sheet>
  );
}

function CategorySheet({ current, busy, error, onClose, onSubmit }: SheetBase & { current: number }) {
  const [ref, setRef] = useState<Reference | null>(null);
  const [categoryId, setCategoryId] = useState(String(current));
  const [reason, setReason] = useState('');
  useEffect(() => {
    api<Reference>('/reference').then(setRef).catch(() => {});
  }, []);
  return (
    <Sheet title="Change category" onClose={onClose}>
      <Form onSubmit={() => onSubmit({ categoryId: Number(categoryId), reason })}>
        <div>
          <label htmlFor="cat" className="field-label">Category</label>
          <select id="cat" className="field-input" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            {ref?.categories.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
          <p className="field-hint">If the new category belongs to another team, the request moves to them and they are emailed.</p>
        </div>
        <div>
          <label htmlFor="cat-reason" className="field-label">Reason (optional)</label>
          <input id="cat-reason" className="field-input" value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        {error && <p className="field-error">{error}</p>}
        <PrimaryButton disabled={busy || Number(categoryId) === current}>{busy ? 'Saving…' : 'Change category'}</PrimaryButton>
      </Form>
    </Sheet>
  );
}

function ResolveSheet({ isRequesterEmailed, busy, error, onClose, onSubmit }: SheetBase & { isRequesterEmailed: boolean }) {
  const [note, setNote] = useState('');
  const [rootCause, setRootCause] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function submit() {
    setUploadError(null);
    let attachments: { key: string; fileName: string; contentType: string }[] = [];
    if (files.length) {
      setUploading(true);
      try {
        attachments = await Promise.all(
          files.map(async (f) => {
            const { blob, name } = await prepareForUpload(f);
            return uploadFile(blob, name);
          }),
        );
      } catch (e) {
        setUploadError((e as Error).message);
        setUploading(false);
        return;
      }
      setUploading(false);
    }
    await onSubmit({ note, rootCause: rootCause || null, attachments });
  }

  return (
    <Sheet title="Complete this request" onClose={onClose}>
      <Form onSubmit={submit}>
        <div>
          <label htmlFor="resolve-note" className="field-label">What was done?</label>
          <textarea id="resolve-note" rows={4} autoFocus className="field-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="E.g. Replaced the failed ballast and both tubes. Tested OK." />
          {isRequesterEmailed && <p className="field-hint">The requester is emailed this and asked to confirm it is fixed.</p>}
        </div>
        <div>
          <label htmlFor="root-cause" className="field-label">Cause (optional, helps spot repeat problems)</label>
          <select id="root-cause" className="field-input" value={rootCause} onChange={(e) => setRootCause(e.target.value)}>
            <option value="">Choose…</option>
            {Object.entries(ROOT_CAUSES)
              .filter(([k]) => k !== 'not_recorded')
              .map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
          </select>
        </div>
        <div>
          <p className="field-label">After photos (optional)</p>
          <input ref={input} type="file" accept="image/*,video/mp4,video/quicktime,application/pdf" multiple hidden onChange={(e) => setFiles((f) => [...f, ...Array.from(e.target.files ?? [])].slice(0, 5))} />
          <div className="flex flex-wrap gap-2">
            {files.map((f, i) => (
              <span key={i} className="inline-flex items-center gap-2 rounded-lg bg-stone-100 px-2.5 py-1.5 text-xs">
                {f.name} <span className="text-stone-500">{formatBytes(f.size)}</span>
                <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles((x) => x.filter((_, j) => j !== i))} className="text-stone-500">✕</button>
              </span>
            ))}
            {files.length < 5 && (
              <button type="button" onClick={() => input.current?.click()} className="rounded-lg px-3 py-1.5 text-sm font-medium text-[#0b2545] ring-1 ring-stone-300 hover:bg-stone-50">
                Add photo
              </button>
            )}
          </div>
        </div>
        {(error || uploadError) && <p className="field-error">{uploadError || error}</p>}
        <PrimaryButton tone="green" disabled={busy || uploading || !note.trim()}>{uploading ? 'Uploading photos…' : busy ? 'Saving…' : 'Mark as complete'}</PrimaryButton>
      </Form>
    </Sheet>
  );
}

function CancelSheet({ busy, error, onClose, onSubmit }: SheetBase) {
  const [reason, setReason] = useState('');
  const [dup, setDup] = useState(false);
  const [duplicateOf, setDuplicateOf] = useState('');
  return (
    <Sheet title="Cancel this request" onClose={onClose}>
      <Form onSubmit={() => onSubmit({ reason, duplicateOf: dup ? duplicateOf : null })}>
        <div>
          <label htmlFor="cancel-reason" className="field-label">Why is it being cancelled?</label>
          <textarea id="cancel-reason" rows={3} autoFocus className="field-input" value={reason} onChange={(e) => setReason(e.target.value)} />
          <p className="field-hint">The requester is emailed this reason.</p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={dup} onChange={(e) => setDup(e.target.checked)} className="accent-[#0b2545]" />
          It&apos;s a duplicate of another request
        </label>
        {dup && <input className="field-input" placeholder="e.g. RMG-000123" value={duplicateOf} onChange={(e) => setDuplicateOf(e.target.value)} />}
        {error && <p className="field-error">{error}</p>}
        <PrimaryButton tone="red" disabled={busy || !reason.trim() || (dup && !duplicateOf.trim())}>{busy ? 'Cancelling…' : 'Cancel request'}</PrimaryButton>
      </Form>
    </Sheet>
  );
}
