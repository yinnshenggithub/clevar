# Clevar

A multi-tenant CRM platform — contacts, companies, and deals with airtight
workspace isolation enforced by PostgreSQL Row-Level Security. Built with
Next.js (App Router), Prisma, and Tailwind, and designed to deploy to Vercel.

## Features

- **Multi-tenant workspaces** — every tenant's data is isolated at the database
  layer (RLS), not just in application code.
- **Authentication** — email/password (bcrypt), JWT session in an httpOnly
  cookie, middleware-gated app routes.
- **CRM core** — contacts (with worldwide phone normalization to E.164),
  companies, and deals organized into pipelines and stages with a board view.
- **Team invites** — owners/admins invite teammates via shareable links.

## Tech stack

| Layer    | Choice                                          |
| -------- | ----------------------------------------------- |
| Framework| Next.js 15 (App Router, Server Actions)         |
| Database | PostgreSQL + Prisma (RLS via `SET LOCAL`)       |
| Auth     | `bcryptjs` + `jose` (HS256 JWT cookie)          |
| UI       | Tailwind CSS + hand-rolled shadcn-style components |
| Hosting  | Vercel + Neon Postgres                          |

## Local development

```bash
cp .env.example .env          # fill DATABASE_URL, DIRECT_URL, AUTH_SECRET
npm install
npx prisma migrate deploy     # creates schema + RLS policies
npm run dev                    # http://localhost:3000
```

`AUTH_SECRET` must be at least 32 characters (`openssl rand -base64 48`).

## Tenant isolation

Every tenant-scoped table carries `workspace_id` and has RLS **enabled and
forced**. Each request runs inside a transaction that binds
`app.workspace_id` via `set_config(..., true)` (see `src/lib/tenant.ts`); the
RLS policies in `prisma/migrations/1_rls/migration.sql` gate every row and a
`BEFORE INSERT` trigger stamps `workspace_id` from that binding. When the
binding is unset, policies fail closed and return zero rows.

## Deploying to Vercel

1. Create a Neon Postgres database; copy the pooled and direct connection
   strings into Vercel env vars `DATABASE_URL` and `DIRECT_URL`.
2. Set `AUTH_SECRET` and `NEXT_PUBLIC_APP_URL` (your production URL).
3. Vercel runs `vercel-build` (`prisma generate && prisma migrate deploy &&
   next build`), so the schema and RLS migrate on every deploy.

## Roadmap

CSV import/export, AI assistants (credit-metered), and a visual workflow
builder are planned as subsequent layers on this foundation.
