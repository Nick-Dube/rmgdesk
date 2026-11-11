'use strict';
// The ticket lifecycle: which actions are allowed, by whom, from which status, and where they lead.
// Kept free of database code so the rules can be tested on their own.
//
//   new ──acknowledge──> triaged ──assign──> assigned ──attending──> attending ──made_safe──> made_safe
//    │                                                                    │
//    └── any open status: hold (on_hold) / resume, change priority, change category, cancel, resolve
//   resolved ──requester confirms──> closed      resolved ──requester says not fixed──> reopened
//   resolved ──3 working days, no answer──> closed (auto)     staff can reopen resolved or closed tickets

const { z } = require('zod');

const OPEN = ['new', 'triaged', 'assigned', 'attending', 'made_safe', 'on_hold', 'reopened'];
const DONE = ['resolved', 'closed', 'cancelled'];
const ROOT_CAUSES = ['wear_and_tear', 'user_damage', 'design_fault', 'installation_fault', 'supplier_fault', 'weather', 'vandalism', 'unknown'];

const isOpen = (status) => OPEN.includes(status);

/** Can this user work this ticket (update status, assign, resolve)? */
function canWork(user, t) {
  if (!user.worksTickets) return false;
  if (user.seesAll) return true;
  return user.serviceLineIds.includes(t.service_line_id) || t.assignee_id === user.id;
}

const optionalText = (max) => z.string().trim().max(max).optional().nullable().transform((v) => v || null);
const requiredText = (max, message) => z.string({ required_error: message }).trim().min(1, message).max(max);
const attachmentRefs = z
  .array(z.object({ key: z.string().max(300), fileName: z.string().trim().min(1).max(200), contentType: z.string().max(100) }))
  .max(5, 'You can attach up to 5 files.')
  .default([]);

/** Every action: who may use it, from which statuses, what it needs, and the resulting status. */
const ACTIONS = {
  acknowledge: { who: 'staff', from: ['new', 'reopened'], to: () => 'triaged', schema: z.object({}) },
  assign: {
    who: 'staff',
    from: OPEN,
    to: (t, input) => (input.assigneeId && ['new', 'triaged', 'reopened'].includes(t.status) ? 'assigned' : t.status),
    schema: z.object({ assigneeId: z.number().int().positive().nullable() }),
  },
  attending: { who: 'staff', from: ['new', 'triaged', 'assigned', 'reopened', 'on_hold'], to: () => 'attending', schema: z.object({ note: optionalText(2000) }) },
  made_safe: { who: 'staff', from: ['new', 'triaged', 'assigned', 'attending', 'reopened'], to: () => 'made_safe', schema: z.object({ note: optionalText(2000) }) },
  hold: {
    who: 'staff',
    from: OPEN.filter((s) => s !== 'on_hold'),
    to: () => 'on_hold',
    schema: z.object({ reason: requiredText(120, 'Say why the request is on hold.'), note: optionalText(2000) }),
  },
  resume: {
    who: 'staff',
    from: ['on_hold'],
    to: (t) => (t.attended_at ? 'attending' : t.assignee_id ? 'assigned' : 'triaged'),
    schema: z.object({ note: optionalText(2000) }),
  },
  resolve: {
    who: 'staff',
    from: OPEN,
    to: () => 'resolved',
    schema: z.object({
      note: requiredText(5000, 'Describe what was done to fix it.'),
      rootCause: z.enum(ROOT_CAUSES).optional().nullable(),
      attachments: attachmentRefs,
    }),
  },
  cancel: {
    who: 'staff',
    from: OPEN,
    to: () => 'cancelled',
    schema: z.object({ reason: requiredText(500, 'Say why the request is being cancelled.'), duplicateOf: optionalText(20) }),
  },
  priority: {
    who: 'staff',
    from: OPEN,
    to: (t) => t.status,
    schema: z.object({ priority: z.enum(['P1', 'P2', 'P3', 'P4']), reason: optionalText(500) }),
  },
  recategorise: {
    who: 'staff',
    from: OPEN,
    to: (t) => t.status,
    schema: z.object({ categoryId: z.number().int().positive(), reason: optionalText(500) }),
  },
  reopen: {
    who: 'staff',
    from: ['resolved', 'closed'],
    to: () => 'reopened',
    schema: z.object({ reason: requiredText(1000, 'Say why the request is being reopened.') }),
  },
  confirm_fixed: {
    who: 'requester',
    from: ['resolved'],
    to: () => 'closed',
    schema: z.object({ rating: z.number().int().min(1).max(5).optional().nullable(), comment: optionalText(2000) }),
  },
  not_fixed: {
    who: 'requester',
    from: ['resolved'],
    to: () => 'reopened',
    schema: z.object({ comment: requiredText(2000, 'Tell us what is still wrong.') }),
  },
  withdraw: {
    who: 'requester',
    from: ['new', 'triaged'],
    to: () => 'cancelled',
    schema: z.object({ reason: optionalText(500) }),
  },
};

/** The actions this user may take on this ticket right now (drives the buttons in the app). */
function allowedActions(user, t) {
  const staff = canWork(user, t);
  const requester = t.requester_id === user.id;
  return Object.entries(ACTIONS)
    .filter(([, a]) => a.from.includes(t.status) && ((a.who === 'staff' && staff) || (a.who === 'requester' && requester)))
    .map(([name]) => name);
}

/** Check an action is allowed and its input is valid. Returns { action, input, nextStatus } or throws { status, message }. */
function plan(user, t, name, rawInput) {
  const action = ACTIONS[name];
  if (!action) throw Object.assign(new Error('Unknown action.'), { status: 400 });
  if (action.who === 'staff' && !canWork(user, t)) throw Object.assign(new Error('Only the team working this request can do that.'), { status: 403 });
  if (action.who === 'requester' && t.requester_id !== user.id) throw Object.assign(new Error('Only the person who raised this request can do that.'), { status: 403 });
  if (!action.from.includes(t.status)) {
    throw Object.assign(new Error(`That can't be done while the request is "${t.status.replace('_', ' ')}".`), { status: 409 });
  }
  const input = action.schema.parse(rawInput || {});
  return { action: name, input, nextStatus: action.to(t, input) };
}

/** A date N working days (Mon-Fri) before `now`. UK bank holidays are not excluded yet. */
function workingDaysBefore(now, n) {
  const d = new Date(now.getTime());
  let left = n;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() - 1);
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) left -= 1;
  }
  return d;
}

module.exports = { OPEN, DONE, ROOT_CAUSES, ACTIONS, isOpen, canWork, allowedActions, plan, workingDaysBefore };
