import type { Priority, Status } from './types';

export const STATUS_LABEL: Record<Status, string> = {
  new: 'New',
  triaged: 'Acknowledged',
  assigned: 'Assigned',
  attending: 'Engineer attending',
  made_safe: 'Made safe',
  on_hold: 'On hold',
  resolved: 'Resolved',
  closed: 'Closed',
  reopened: 'Reopened',
  cancelled: 'Cancelled',
};

export const STATUS_TONE: Record<Status, string> = {
  new: 'bg-sky-100 text-sky-900 ring-sky-200',
  triaged: 'bg-sky-100 text-sky-900 ring-sky-200',
  assigned: 'bg-indigo-100 text-indigo-900 ring-indigo-200',
  attending: 'bg-amber-100 text-amber-900 ring-amber-200',
  made_safe: 'bg-amber-100 text-amber-900 ring-amber-200',
  on_hold: 'bg-stone-200 text-stone-800 ring-stone-300',
  resolved: 'bg-emerald-100 text-emerald-900 ring-emerald-200',
  closed: 'bg-stone-100 text-stone-600 ring-stone-200',
  reopened: 'bg-rose-100 text-rose-900 ring-rose-200',
  cancelled: 'bg-stone-100 text-stone-500 ring-stone-200',
};

export const PRIORITY_TONE: Record<Priority, string> = {
  P1: 'bg-rose-600 text-white',
  P2: 'bg-amber-500 text-stone-950',
  P3: 'bg-sky-700 text-white',
  P4: 'bg-stone-500 text-white',
};

const dateFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });

export function when(iso: string) {
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 24 * 60 && new Date().toDateString() === d.toDateString()) return `today ${timeFmt.format(d)}`;
  return `${dateFmt.format(d)}, ${timeFmt.format(d)}`;
}

export const ROOT_CAUSES: Record<string, string> = {
  wear_and_tear: 'Wear and tear',
  user_damage: 'Accidental damage',
  design_fault: 'Design fault',
  installation_fault: 'Installation fault',
  supplier_fault: 'Supplier fault',
  weather: 'Weather',
  vandalism: 'Vandalism',
  unknown: 'Not known',
  not_recorded: 'Not recorded',
};

export const ROLE_LABEL: Record<string, string> = {
  requester: 'Requester',
  agent: 'Agent',
  lead: 'Team lead',
  viewer: 'Viewer',
  rmg_superuser: 'RMG superuser',
  vertex_helpdesk: 'Vertex helpdesk',
  vertex_superuser: 'Vertex superuser',
};

export const USER_STATUS: Record<string, { label: string; tone: string }> = {
  invited: { label: 'Invited', tone: 'bg-sky-100 text-sky-900 ring-sky-200' },
  active: { label: 'Active', tone: 'bg-emerald-100 text-emerald-900 ring-emerald-200' },
  suspended: { label: 'Suspended', tone: 'bg-amber-100 text-amber-900 ring-amber-200' },
  disabled: { label: 'Offboarded', tone: 'bg-stone-200 text-stone-700 ring-stone-300' },
};

export function shortDate(iso: string | null | undefined) {
  return iso ? dateFmt.format(new Date(iso)) : '';
}

export const isAdmin = (role?: string) => role === 'rmg_superuser' || role === 'vertex_superuser';
