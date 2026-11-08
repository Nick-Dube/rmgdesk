export type Priority = 'P1' | 'P2' | 'P3' | 'P4';
export type Status =
  | 'new'
  | 'triaged'
  | 'assigned'
  | 'attending'
  | 'made_safe'
  | 'on_hold'
  | 'resolved'
  | 'closed'
  | 'reopened'
  | 'cancelled';

export interface Me {
  user: {
    id: number;
    email: string;
    fullName: string;
    role: string;
    seesAll: boolean;
    worksTickets: boolean;
    organisation: { code: string; name: string };
  };
}

export interface Reference {
  sites: { id: number; code: string; name: string }[];
  buildings: { id: number; siteId: number; name: string }[];
  categories: { id: number; label: string; defaultPriority: Priority | null }[];
  priorities: { code: Priority; label: string; description: string }[];
  announcements: { id: number; siteId: number | null; buildingId: number | null; message: string }[];
  emergency: string;
  helpdeskPhone: string;
}

export interface TicketSummary {
  id: number;
  reference: string;
  title: string;
  priority: Priority;
  status: Status;
  createdAt: string;
  updatedAt: string;
  siteCode: string;
  building: string;
  location: string | null;
  category: string;
  serviceLine: string | null;
}

export interface TicketEvent {
  id: number;
  type: string;
  body: string | null;
  data: Record<string, unknown> | null;
  isInternal: boolean | number;
  createdAt: string;
  actorName: string | null;
}

export interface TicketDetail {
  ticket: {
    id: number;
    reference: string;
    title: string;
    description: string;
    priority: Priority;
    status: Status;
    site: { code: string; name: string };
    building: string;
    location: string | null;
    category: string;
    serviceLine: string | null;
    department: string | null;
    requester: { name: string | null; email?: string };
    evolutionTaskNo?: string | null;
    createdAt: string;
    updatedAt: string;
    resolvedAt: string | null;
  };
  events: TicketEvent[];
  attachments: { id: number; fileName: string; contentType: string; size: number; stage: string; url: string }[];
}
