'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { api, ApiError, uploadFile } from '@/lib/api';
import { formatBytes, prepareForUpload } from '@/lib/image';
import type { Priority, Reference } from '@/lib/types';

const MAX_FILES = 5;
const REMEMBER_KEY = 'rmgdesk.requester';

type Picked = { id: string; file: File; preview: string | null };

function remembered(): { department?: string; phone?: string } {
  try {
    return JSON.parse(localStorage.getItem(REMEMBER_KEY) || '{}');
  } catch {
    return {};
  }
}

export default function NewRequest() {
  const [ref, setRef] = useState<Reference | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [buildingId, setBuildingId] = useState('');
  const [locationText, setLocationText] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [priority, setPriority] = useState<Priority | ''>('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [departmentName, setDepartmentName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [files, setFiles] = useState<Picked[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState<{ id: number; reference: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api<Reference>('/reference').then(setRef).catch((e) => setLoadError(e.message));
    const r = remembered();
    setDepartmentName(r.department ?? '');
    setContactPhone(r.phone ?? '');
  }, []);

  const buildingsBySite = useMemo(() => {
    if (!ref) return [];
    return ref.sites.map((s) => ({ site: s, buildings: ref.buildings.filter((b) => b.siteId === s.id) })).filter((g) => g.buildings.length);
  }, [ref]);

  const announcements = useMemo(() => {
    if (!ref) return [];
    const b = ref.buildings.find((x) => String(x.id) === buildingId);
    return ref.announcements.filter((a) => (!a.siteId && !a.buildingId) || (b && (a.buildingId === b.id || a.siteId === b.siteId)));
  }, [ref, buildingId]);

  function addFiles(list: FileList | null) {
    if (!list) return;
    const next = [...files];
    for (const file of Array.from(list)) {
      if (next.length >= MAX_FILES) break;
      next.push({ id: crypto.randomUUID(), file, preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : null });
    }
    setFiles(next);
    if (fileInput.current) fileInput.current.value = '';
  }

  function removeFile(id: string) {
    setFiles((fs) => {
      const f = fs.find((x) => x.id === id);
      if (f?.preview) URL.revokeObjectURL(f.preview);
      return fs.filter((x) => x.id !== id);
    });
  }

  function validate() {
    const e: Record<string, string> = {};
    if (!buildingId) e.buildingId = 'Choose the building.';
    if (locationText.trim().length < 2) e.locationText = 'Say where in the building, e.g. "Gallery 3, by the lift".';
    if (!categoryId) e.categoryId = 'Choose the closest category.';
    if (!priority) e.priority = 'Choose a priority.';
    if (title.trim().length < 10) e.title = 'Give a short summary of at least 10 characters.';
    if (!description.trim()) e.description = 'Describe the problem.';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    setFormError(null);
    if (!validate()) return;
    setSubmitting(true);
    try {
      const attachments = [];
      for (let i = 0; i < files.length; i++) {
        setProgress(`Uploading ${i + 1} of ${files.length}…`);
        const { blob, name } = await prepareForUpload(files[i].file);
        attachments.push(await uploadFile(blob, name));
      }
      setProgress('Sending your request…');
      const res = await api<{ id: number; reference: string }>('/tickets', {
        method: 'POST',
        body: JSON.stringify({
          buildingId: Number(buildingId),
          categoryId: Number(categoryId),
          priority,
          title,
          description,
          locationText,
          departmentName: departmentName || null,
          contactPhone: contactPhone || null,
          attachments,
        }),
      });
      try {
        localStorage.setItem(REMEMBER_KEY, JSON.stringify({ department: departmentName, phone: contactPhone }));
      } catch {
        /* private browsing: nothing to remember */
      }
      setDone(res);
      window.scrollTo({ top: 0 });
    } catch (e) {
      const err = e as ApiError;
      if (err.details?.length) {
        setErrors(Object.fromEntries(err.details.map((d) => [d.field, d.message])));
      }
      setFormError(err.message);
    } finally {
      setSubmitting(false);
      setProgress('');
    }
  }

  if (done) {
    return (
      <div className="mx-auto max-w-xl rounded-3xl bg-white p-8 text-center ring-1 ring-stone-200">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-2xl text-emerald-700">✓</div>
        <h1 className="mt-4 text-2xl font-semibold">Request logged</h1>
        <p className="mt-2 text-stone-600">
          Your reference is <span className="font-mono font-semibold text-stone-900">{done.reference}</span>. It has gone to the right
          team, and you can follow its progress here.
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Link href={`/ticket/?id=${done.id}`} className="rounded-xl bg-[#0b2545] px-5 py-3 font-semibold text-white">
            View request
          </Link>
          <button
            onClick={() => window.location.reload()}
            className="rounded-xl px-5 py-3 font-semibold text-[#0b2545] ring-1 ring-stone-300"
          >
            Raise another
          </button>
        </div>
      </div>
    );
  }

  if (loadError) return <p className="field-error">{loadError}</p>;
  if (!ref) return <p className="text-stone-500">Loading…</p>;

  return (
    <form onSubmit={submit} noValidate className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Raise a request</h1>
        <p className="mt-1 text-stone-600">Tell us what&apos;s wrong and where. It goes straight to the team that fixes it.</p>
      </div>

      {announcements.map((a) => (
        <div key={a.id} className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-200">
          <strong>Already known: </strong>
          {a.message}
        </div>
      ))}

      <section className="space-y-5 rounded-2xl bg-white p-5 ring-1 ring-stone-200 sm:p-6">
        <h2 className="font-semibold">Where</h2>
        <div>
          <label htmlFor="building" className="field-label">Building</label>
          <select id="building" className="field-input" value={buildingId} onChange={(e) => setBuildingId(e.target.value)}>
            <option value="">Choose a building</option>
            {buildingsBySite.map((g) => (
              <optgroup key={g.site.id} label={g.site.name}>
                {g.buildings.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </optgroup>
            ))}
          </select>
          {errors.buildingId && <p className="field-error">{errors.buildingId}</p>}
        </div>
        <div>
          <label htmlFor="location" className="field-label">Exact location</label>
          <input id="location" className="field-input" maxLength={200} placeholder="e.g. Gallery 3, next to the lift" value={locationText} onChange={(e) => setLocationText(e.target.value)} />
          {errors.locationText && <p className="field-error">{errors.locationText}</p>}
        </div>
      </section>

      <section className="space-y-5 rounded-2xl bg-white p-5 ring-1 ring-stone-200 sm:p-6">
        <h2 className="font-semibold">What</h2>
        <div>
          <label htmlFor="category" className="field-label">Category</label>
          <select id="category" className="field-input" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">Choose the closest category</option>
            {ref.categories.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
          {errors.categoryId && <p className="field-error">{errors.categoryId}</p>}
        </div>

        <div>
          <label htmlFor="title" className="field-label">Short summary</label>
          <input id="title" className="field-input" maxLength={100} placeholder="e.g. Water dripping from ceiling" value={title} onChange={(e) => setTitle(e.target.value)} />
          <p className="field-hint">{title.length}/100</p>
          {errors.title && <p className="field-error">{errors.title}</p>}
        </div>

        <div>
          <label htmlFor="description" className="field-label">Description</label>
          <textarea id="description" rows={5} className="field-input" maxLength={5000} placeholder="What you can see, when it started, and anything already done about it." value={description} onChange={(e) => setDescription(e.target.value)} />
          {errors.description && <p className="field-error">{errors.description}</p>}
        </div>

        <div>
          <span className="field-label">Photos or video (optional, up to {MAX_FILES})</span>
          <div className="flex flex-wrap gap-3">
            {files.map((f) => (
              <div key={f.id} className="relative h-24 w-24 overflow-hidden rounded-xl bg-stone-100 ring-1 ring-stone-200">
                {f.preview ? (
                  <img src={f.preview} alt={f.file.name} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center p-2 text-center text-xs text-stone-600">{f.file.name}</div>
                )}
                <span className="absolute bottom-0 left-0 right-0 bg-black/50 px-1 text-[10px] text-white">{formatBytes(f.file.size)}</span>
                <button type="button" onClick={() => removeFile(f.id)} aria-label={`Remove ${f.file.name}`} className="absolute right-1 top-1 h-6 w-6 rounded-full bg-black/60 text-sm leading-6 text-white">×</button>
              </div>
            ))}
            {files.length < MAX_FILES && (
              <label className="flex h-24 w-24 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-stone-300 text-sm text-stone-600 hover:border-[#0b2545] hover:text-[#0b2545]">
                <span className="text-2xl leading-none">+</span>
                <span>Add</span>
                <input ref={fileInput} type="file" accept="image/*,video/mp4,video/quicktime,application/pdf" multiple className="sr-only" onChange={(e) => addFiles(e.target.files)} />
              </label>
            )}
          </div>
          <p className="field-hint">Please avoid photographing visitors.</p>
        </div>
      </section>

      <section className="space-y-4 rounded-2xl bg-white p-5 ring-1 ring-stone-200 sm:p-6">
        <h2 className="font-semibold">How urgent</h2>
        <div className="grid gap-3">
          {ref.priorities.map((p) => (
            <label key={p.code} className={`flex cursor-pointer gap-3 rounded-xl p-4 ring-1 ${priority === p.code ? 'bg-[#0b2545]/5 ring-2 ring-[#0b2545]' : 'ring-stone-200 hover:bg-stone-50'}`}>
              <input type="radio" name="priority" value={p.code} checked={priority === p.code} onChange={() => setPriority(p.code)} className="mt-1 accent-[#0b2545]" />
              <span>
                <span className="block font-medium">{p.label}</span>
                <span className="block text-sm text-stone-600">{p.description}</span>
              </span>
            </label>
          ))}
        </div>
        {priority === 'P1' && (
          <div className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-900 ring-1 ring-rose-200">
            If anyone is at risk, <strong>call Security Control on 6555 now</strong>, then raise this request.
          </div>
        )}
        {errors.priority && <p className="field-error">{errors.priority}</p>}
      </section>

      <section className="grid gap-5 rounded-2xl bg-white p-5 ring-1 ring-stone-200 sm:grid-cols-2 sm:p-6">
        <div>
          <label htmlFor="department" className="field-label">Your department (optional)</label>
          <input id="department" className="field-input" maxLength={120} value={departmentName} onChange={(e) => setDepartmentName(e.target.value)} />
        </div>
        <div>
          <label htmlFor="phone" className="field-label">Phone or extension (optional)</label>
          <input id="phone" type="tel" className="field-input" maxLength={30} value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
        </div>
      </section>

      {formError && <p className="rounded-xl bg-rose-50 px-4 py-3 text-rose-900 ring-1 ring-rose-200">{formError}</p>}

      <div className="sticky bottom-16 z-10 sm:static">
        <button type="submit" disabled={submitting} className="w-full rounded-xl bg-[#0b2545] px-5 py-4 text-lg font-semibold text-white shadow-lg disabled:opacity-60 sm:shadow-none">
          {submitting ? progress || 'Sending…' : 'Submit request'}
        </button>
      </div>
    </form>
  );
}
