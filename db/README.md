# Database

Migrations use [dbmate](https://github.com/amacneil/dbmate). Each file has an `-- migrate:up` and a `-- migrate:down` section.
Never edit a migration that has already run in production: add a new one.

```bash
# 1. In one terminal, open the tunnel
./scripts/db-tunnel.sh prod

# 2. In another, run the migrations (password from Secrets Manager: rmgdesk-prod/db-admin)
export DATABASE_URL='mysql://rmgadmin:<password>@127.0.0.1:3307/rmgdesk?tls=skip-verify'
dbmate --migrations-dir db/migrations --no-dump-schema status
dbmate --migrations-dir db/migrations --no-dump-schema up

# New migration
dbmate --migrations-dir db/migrations new add_something
```

`tls=skip-verify` is needed only through the tunnel, because the certificate names the RDS host, not 127.0.0.1. The traffic is still encrypted.
