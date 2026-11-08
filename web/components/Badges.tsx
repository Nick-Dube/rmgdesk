import { PRIORITY_TONE, STATUS_LABEL, STATUS_TONE } from '@/lib/format';
import type { Priority, Status } from '@/lib/types';

export function StatusBadge({ status }: { status: Status }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${STATUS_TONE[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

export function PriorityBadge({ priority }: { priority: Priority }) {
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-bold ${PRIORITY_TONE[priority]}`}>
      {priority}
    </span>
  );
}
