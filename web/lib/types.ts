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
  assignee: string | null;
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

export type Action =
  | 'acknowledge'
  | 'assign'
  | 'attending'
  | 'made_safe'
  | 'hold'
  | 'resume'
  | 'resolve'
  | 'cancel'
  | 'priority'
  | 'recategorise'
  | 'reopen'
  | 'confirm_fixed'
  | 'not_fixed'
  | 'withdraw';

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
    categoryId: number;
    category: string;
    serviceLineId: number | null;
    serviceLine: string | null;
    isEvolutionLinked: boolean;
    assignee: { id: number; name: string } | null;
    department: string | null;
    requester: { name: string | null; email?: string };
    contactPhone?: string | null;
    evolutionTaskNo?: string | null;
    holdReason: string | null;
    resolutionNote: string | null;
    rootCause?: string | null;
    satisfaction: number | null;
    closedReason: string | null;
    createdAt: string;
    updatedAt: string;
    resolvedAt: string | null;
    closedAt: string | null;
  };
  isRequester: boolean;
  canWork: boolean;
  actions: Action[];
  events: TicketEvent[];
  attachments: { id: number; fileName: string; contentType: string; size: number; stage: string; url: string }[];
}

export interface Assignee {
  id: number;
  name: string;
  organisation: string;
  role: string;
}

// ------------------------------------------------------------------ admin
export interface AdminOptions {
  organisations: { id: number; code: string; name: string; type: string }[];
  roles: { code: string; label: string; description: string }[];
  serviceLines: { id: number; code: string; name: string; organisationId: number; isEvolutionLinked: boolean }[];
  sites: { id: number; code: string; name: string }[];
  buildings: { id: number; siteId: number; name: string }[];
  categories: { id: number; label: string }[];
  me: { id: number; role: string };
}

export interface AdminUserRow {
  id: number;
  email: string;
  fullName: string;
  role: string;
  status: 'invited' | 'active' | 'suspended' | 'disabled';
  hasSignedIn: boolean;
  lastSignInAt: string | null;
  invitedAt: string | null;
  organisationCode: string;
  organisation: string;
  teams: string | null;
}

export interface AdminUser {
  id: number;
  email: string;
  fullName: string;
  phone: string | null;
  organisation: { id: number; code: string; name: string };
  role: string;
  status: AdminUserRow['status'];
  notifyMode: 'instant' | 'digest' | 'off';
  hasSignedIn: boolean;
  lastSignInAt: string | null;
  invitedBy: string | null;
  invitedAt: string | null;
  createdAt: string;
  teams: { id: number; code: string; name: string }[];
}

export interface AuditEntry {
  id: number;
  action: string;
  entity?: string;
  entityId?: string;
  beforeData: Record<string, unknown> | null;
  afterData: Record<string, unknown> | null;
  ip?: string | null;
  createdAt: string;
  actorName: string | null;
  subject?: string | null;
}

export interface RoutingRule {
  categoryId: number;
  category: string;
  ruleId: number | null;
  siteId: number | null;
  site: string | null;
  serviceLineId: number | null;
  serviceLine: string | null;
  isEvolutionLinked: boolean;
  effectiveFrom: string | null;
  notes: string | null;
  recipients: { email: string; kind: 'to' | 'cc'; name: string | null; inactive: boolean }[];
}

export interface Announcement {
  id: number;
  message: string;
  siteId: number | null;
  site: string | null;
  buildingId: number | null;
  building: string | null;
  startsAt: string;
  endsAt: string | null;
  createdBy: string | null;
  live: boolean;
}

// ------------------------------------------------------------------ insights
export interface Insights {
  days: number;
  scope: 'all' | 'teams';
  summary: {
    openNow: number;
    openP1: number;
    raised: number;
    resolved: number;
    avgDaysToResolve: number | null;
    reopenRate: number | null;
    satisfaction: number | null;
    ratings: number;
  };
  backlog: {
    ageing: { label: string; n: number }[];
    byStatus: { label: Status; n: number }[];
    byPriority: { label: Priority; n: number }[];
  };
  trend: { month: string; raised: number; resolved: number }[];
  bySite: { label: string; raised: number; open: number }[];
  byCategory: { label: string; raised: number; open: number }[];
  byServiceLine: { label: string; raised: number; open: number; avgDaysToResolve: number | null }[];
  repeats: { building: string; siteCode: string; category: string; n: number; lastRaised: string; lastTicketId: number }[];
  rootCauses: { cause: string; n: number }[];
}
