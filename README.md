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
