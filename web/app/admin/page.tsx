'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { isAdmin } from '@/lib/format';
import type { AdminOptions } from '@/lib/types';
import { useMe } from '@/components/MeContext';
import { People } from '@/components/admin/People';
import { Routing } from '@/components/admin/Routing';
import { Announcements } from '@/components/admin/Announcements';
import { AuditLog } from '@/components/admin/AuditLog';

const TABS = [
  { key: 'people', label: 'People' },
  { key: 'routing', label: 'Routing' },
  { key: 'announcements', label: 'Announcements' },
  { key: 'audit', label: 'Audit log' },
] as const;

function Admin() {
  const me = useMe();
  const router = useRouter();
  const tab = useSearchParams().get('tab') ?? 'people';
  const [options, setOptions] = useState<AdminOptions | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isAdmin(me?.role)) api<AdminOptions>('/admin/options').then(setOptions).catch((e) => setError(e.message));
  }, [me?.role]);

  if (me && !isAdmin(me.role)) return <p className="rounded-2xl bg-white p-6 ring-1 ring-stone-200">The admin console is for RMG and Vertex superusers.</p>;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">Admin</h1>
        <p className="text-sm text-stone-600">People, routing and announcements. Every change is recorded in the audit log.</p>
      </div>
      <div className="-mx-4 overflow-x-auto px-4">
        <div className="flex w-max gap-1 rounded-xl bg-stone-100 p-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => router.replace(`/admin/?tab=${t.key}`)}
              className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium ${tab === t.key ? 'bg-[#0b2545] text-white' : 'text-stone-600 hover:bg-stone-200'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      {error && <p className="field-error">{error}</p>}
      {!options && !error && <p className="text-stone-500">Loading…</p>}
      {options && tab === 'people' && <People options={options} />}
      {options && tab === 'routing' && <Routing options={options} />}
      {options && tab === 'announcements' && <Announcements options={options} />}
      {options && tab === 'audit' && <AuditLog />}
    </div>
  );
}

export default function AdminPage() {
  return (
    <Suspense fallback={<p className="text-stone-500">Loading…</p>}>
      <Admin />
    </Suspense>
  );
}
