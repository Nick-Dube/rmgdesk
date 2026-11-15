# RMG Helpdesk (rmgdesk.com)

The helpdesk for Royal Museums Greenwich, built and run by Vertex Services Group.

| Folder | What it is |
| --- | --- |
| `infra/` | AWS CDK (TypeScript): VPC, RDS MySQL + RDS Proxy, SSM bastion, Cognito, S3, SQS, HTTP API, Lambdas, SES, alarms, budget |
| `api/` | Lambda handlers (Node.js 22, CommonJS) and tests |
| `db/` | dbmate migrations: schema and reference data (sites, buildings, 49 categories, routing, SLA matrix) |
| `web/` | Next.js app (static export) on Amplify Hosting |
| `scripts/` | Helpers, such as the database tunnel |

## Everyday commands

```bash
# API tests (add DB_* variables to run the end-to-end tests against a database)
cd api && npm test

# Web app locally (needs web/.env.local with the stack outputs)
cd web && npm run dev

# See what a deploy would change, then deploy
cd infra && npx cdk diff -c env=prod
cd infra && npx cdk deploy -c env=prod
```

The step-by-step build runbook lives in the "RMG Helpdesk - Build Runbook" document.

## What the API does

| Route | Handler | Who |
| --- | --- | --- |
| `GET /me`, `GET /reference` | me, reference | everyone signed in |
| `POST /tickets`, `GET /tickets?scope=mine\|assigned\|queue\|all` | tickets | everyone (scopes by role) |
| `GET /tickets/{id}`, `POST /tickets/{id}/comments` | tickets | people who can see the request |
| `POST /tickets/{id}/actions` | tickets | the team (acknowledge, assign, attending, made safe, hold, resume, complete, cancel, priority, category, reopen) and the requester (confirm fixed, not fixed, withdraw) |
| `GET /tickets/{id}/assignees` | tickets | the team |
| `GET /tickets/search`, `GET /tickets/filters` | tickets | the Requests table: filters, sorting, pages (`api/src/lib/search.js`) |
| `POST /tickets/export` | exportTickets | Excel or CSV of the filtered requests, saved to S3 `exports/` (kept 1 day) and downloaded by a 15-minute link |
| `GET /insights?days=30\|90\|365\|0` | insights | staff and viewers (0 = all time) |
| `/admin/...` | admin | RMG and Vertex superusers (people, routing, announcements, audit log) |
| `POST /integrations/evolution/task-status` | evolutionWebhook | MRI Evolution workflows (shared token, no Cognito): task statuses (ASSIGNED, COMPLETE, CANCELLED) and engineer events (Arrived, Started, Paused). The workflow code is in `docs/evolution-workflow/` |

The rules for who can do what, and which status each action leads to, are in `api/src/lib/workflow.js`.
Background work: `notifier` (emails, from the notifications queue), `evolutionWorker` (MRI Evolution, from the
integrations queue) and `autoClose` (weekdays 07:00 UTC: closes requests resolved 3+ working days ago with no answer).

## Importing the old helpdesk's history

`api/scripts/import-legacy.js` reads the Google Sheet export (Tasks tab: Date Task Raised, Building, Location,
Category, Problem, Department, Priority, Sequence) and adds each row as a read-only request `LEG-<Sequence>`.
It runs through the database tunnel, does a dry run unless given `--apply`, and skips rows already imported,
so it can be run again at cutover to top up. Imported requests have no requester (the old form kept none),
no outcome, and are left out of resolution times and reopen rates in Insights.
