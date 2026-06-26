# CLEVAR Foundation Design Specification

**Status:** Draft for review · **Date:** 2026-06-26 · **Scope:** Foundation / spec #1

CLEVAR is a multi-tenant, CRM-first SaaS platform built as one unified TypeScript monorepo. This specification covers the **Foundation only**: multi-tenant workspaces, authentication, and the CRM core (contacts, companies, deals with pipelines/stages, notes, custom fields, and saved views), with tenant isolation enforced at the database layer by PostgreSQL Row-Level Security. Chat/inbox, AI agents, the workflow builder, and billing are deliberately deferred to later specs and appear here only as named seams. The document's thesis: solve the hard, easy-to-get-wrong parts — provable tenant isolation, stateless auth, horizontal scalability — once and correctly, so later layers attach without reworking the core.

## Table of Contents

1. [Overview, Goals & Scope](#1-overview-goals--scope)
2. [System Architecture](#2-system-architecture)
3. [Multi-Tenancy, Auth & Security](#3-multi-tenancy-auth--security)
4. [Data Model](#4-data-model)
5. [API Design](#5-api-design)
6. [Frontend / UI Architecture](#6-frontend--ui-architecture)
7. [Repo, Tooling, Infra & Testing](#7-repo-tooling-infra--testing)
8. [Open Questions](#8-open-questions-consolidated)
9. [Assumptions](#9-assumptions)
10. [Roadmap (Later Specs)](#10-roadmap-later-specs)

---

## Canonical naming registry

To prevent the cross-section drift that a code-first spec cannot tolerate, the following names are canonical and used everywhere in this document. Where a section sketch is abbreviated, the Data Model (§4) is the authoritative persistence contract and the API SDL (§5) is the authoritative wire contract.

| Concept | DB table | Prisma model | GraphQL type / enum | Notes |
|---|---|---|---|---|
| Tenant | `workspaces` | `Workspace` | `Workspace` | |
| Membership | `workspace_members` | `WorkspaceMember` | `Member` | NOT RLS-protected (read pre-tenant-context) |
| User | `users` | `User` | `User` | Global identity |
| Invite | `invitations` | `Invitation` | (no type; REST/mutation only) | Global token table, RLS-exempt by design (see §3) |
| Custom-field metadata | `field_definitions` | `FieldDefinition` | `FieldDefinition` | **RLS-protected** tenant table |
| Object kinds | enum `object_type` | `ObjectType` | `ObjectType { COMPANY CONTACT DEAL }` | One enum reused for fields, views, note targets |
| App package (HTTP) | — | — | — | `apps/api` (`@clevar/api`) |
| App package (jobs) | — | — | — | `apps/worker` (`@clevar/worker`) |
| App package (SPA) | — | — | — | `apps/web` (`@clevar/web`) |
| DB package | — | — | — | `packages/db` (`@clevar/db`) |

**Enum casing rule:** GraphQL enums are `UPPER_CASE` on the wire; the service layer maps them 1:1 to `lower_case` PostgreSQL enums (e.g. GraphQL `OWNER` ↔ DB `owner`). This rule applies to every enum (`WorkspaceRole`, `DealStatus`, `StageType`, `ObjectType`, `FieldDataType`, `ViewKind`, `MemberStatus`, `NoteTargetType`).

**Money rule:** Deal `amount` is `numeric(18,2)` with a per-deal `currency char(3)` (ISO 4217). Never floats, never integer-minor-units. Exposed in GraphQL as a `Decimal` scalar (string-encoded).

**GUC rule:** Tenant context is set exactly once per request via a single canonical helper: `SELECT set_config('app.workspace_id', $1, true)` (parameterized, transaction-local). `SET LOCAL app.workspace_id = '...'` (string-interpolated) is never used, including in tests.

**Role rule:** The runtime role is, everywhere, `CREATE ROLE clevar_app LOGIN PASSWORD :secret NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`. There is no `NOLOGIN` variant.

---

## 1. Overview, Goals & Scope

### 1.1 Problem Statement

Growing revenue teams run their customer relationships across disconnected tools: a spreadsheet of leads, a billing portal of accounts, email threads for conversations, and tribal knowledge for "what stage is this deal at." Each tool has its own notion of identity, its own access model, and no shared definition of a contact, a company, or a deal. The result is duplicated data, no single source of truth for the pipeline, and reporting reconstructed by hand every week.

Existing CRM products solve part of this but introduce their own problems for a vendor that wants to build *on top* of a CRM:

| Pain | Consequence |
| --- | --- |
| Rigid object models | Every team's "deal" is slightly different; vendors fork or bolt on brittle custom-field hacks. |
| Per-tenant schema / per-tenant database isolation | Operationally heavy; migrations fan out across thousands of schemas; hard to scale to millions of users. |
| Isolation enforced only in application code | A single missing `WHERE workspace_id = ?` leaks one tenant's data into another's — a catastrophic, silent failure. |
| Monolithic feature surface | Chat, automation, billing, and AI are entangled with the CRM core, so the foundation can never be reasoned about or shipped independently. |

**CLEVAR's thesis:** a CRM is the *system of record for relationships*, and everything else — conversations, automation, AI — is a layer on top. The relationship record, its multi-tenancy, and its access model must be built first, correctly, and provably isolated and horizontally scalable. That foundation is the entire subject of this specification.

### 1.2 What CLEVAR Is

CLEVAR is a **multi-tenant SaaS, CRM-first** platform. The unit of tenancy is a **workspace**: an isolated container that owns all of its members, CRM data, configuration, and custom-field definitions. A single CLEVAR deployment serves many workspaces from shared infrastructure, with isolation enforced at the database layer (not merely in application code), so the platform scales to millions of users without sacrificing tenant separation.

This Foundation release delivers exactly one product surface: a **CRM core** — contacts, companies, and deals organized into pipelines and stages, annotated with notes, filtered through saved views, and extensible via custom fields — wrapped in **authentication** and **workspace membership**. It is deliberately *not* a chat tool, an automation engine, an AI assistant, or a billing system. Those are later, separately specified layers (see §10) that consume this foundation through the same authenticated, tenant-isolated GraphQL surface that the CRM UI uses.

```
                          ┌──────────────────────────────────────────────┐
   FUTURE LAYERS (not     │  AI agents + credits · workflow builder ·      │
   in this spec)          │  channels / inbox                              │
                          └───────────────────────┬──────────────────────┘
                                                  │ consumes (same GraphQL + auth + RLS)
   ┌──────────────────────────────────────────────▼──────────────────────┐
   │  CLEVAR FOUNDATION  (THIS SPEC)                                       │
   │  Auth (JWT access + refresh cookie)  ·  Workspaces & membership       │
   │  CRM core: contacts · companies · deals · pipelines/stages · notes    │
   │  Saved views  ·  Custom fields (JSONB + field_definitions)            │
   │  Tenant isolation: shared schema + PostgreSQL Row-Level Security      │
   └───────────────────────────────────────────────────────────────────-─┘
```

### 1.3 Goals & Non-Goals

**Goals**

- **G1 — Provable tenant isolation.** No request can read or write another workspace's rows, even if a developer forgets a `workspace_id` filter. Enforced by PostgreSQL RLS with a non-superuser, non-`BYPASSRLS` application role; application code is a second line of defense, never the only one.
- **G2 — A complete, usable CRM core.** Contacts, companies, deals, pipelines with ordered stages, notes, and saved views are fully creatable, queryable, updatable, soft-deletable, and restorable through a typed GraphQL API and a React UI with a sortable/filterable table experience.
- **G3 — Extensibility without DDL.** Each tenant adds custom fields to core objects without altering the schema, via a JSONB column plus a `field_definitions` metadata table.
- **G4 — Secure, modern authentication.** Email/password with argon2id hashing, short-lived JWT access tokens (15 minutes), rotating refresh tokens in an httpOnly cookie, email verification and password reset, and workspace-scoped role checks on every operation.
- **G5 — Horizontal scalability.** Stateless API and worker tiers; all session/async state in Redis/Postgres; no per-tenant schema or per-tenant connection. Targets millions of users across hundreds of thousands of workspaces.
- **G6 — A single, coherent codebase.** One unified TypeScript monorepo (pnpm + Turborepo) with code-first GraphQL keeping the contract in lockstep.
- **G7 — Operational readiness.** Async work runs through a durable queue; the system ships migrations, seeds, health checks, and minimal observability hooks suitable for production from day one.

**Non-Goals (deferred, not deficiencies)**

- **N1 — No chat / inbox / messaging.**
- **N2 — No AI agents, no credit/usage metering.**
- **N3 — No workflow / automation builder.**
- **N4 — No billing, plans, or payments.**
- **N5 — No third-party CRM data sync / import connectors.** (CSV import may be a thin follow-on but is not specified here.)
- **N6 — No marketplace, no public app/plugin platform, no SSO/SAML/SCIM.** (Email/password only.)
- **N7 — No reporting/analytics warehouse, dashboards, BI, scheduled exports, or forecasting models.** Saved views provide filtered lists, not aggregate reporting.
- **N8 — No full-text/cross-object search infrastructure** (no tsvector/trigram index tier, no maintained search index). The ⌘K palette is a bounded `ILIKE` name lookup (§6.1); richer search is a later spec.
- **N9 — No mobile or native clients.** Responsive web only.

### 1.4 In-Scope vs Out-of-Scope (precise)

This table is the authoritative scope boundary. Anything not "In scope" is out of scope for the Foundation.

| Domain | In scope (this spec) | Out of scope (deferred) |
| --- | --- | --- |
| **Tenancy** | Workspace creation; shared-schema isolation; `workspace_id` on every tenant table; RLS policies; per-request `SET LOCAL app.workspace_id` inside one transaction; non-`BYPASSRLS` app role; per-tenant resource ceilings (§1.6) | Per-tenant schemas/databases; region sharding; data residency controls |
| **Identity & auth** | Email/password signup & login; argon2id; JWT access (15m); refresh-token rotation in httpOnly cookie; logout/revocation; **email verification & password reset (token-based)**; transactional email transport | SSO/SAML/OIDC, SCIM, magic links, MFA/TOTP, social login |
| **Membership & roles** | Workspace membership; `owner`/`admin`/`member`; invite-by-email; role checks via guards | Custom roles, per-field/per-record permissions, teams/groups |
| **CRM objects** | `contacts`, `companies`, `deals`; deal↔pipeline/stage; contact↔company; notes attached to any object; relations between objects | Activities/tasks/calendar, products/line-items/quotes, files/attachments store |
| **Pipelines** | Multiple pipelines per workspace; ordered stages; deal stage transitions; stage metadata (name, position, probability 0–100, type ∈ `open`/`won`/`lost`, color) | Automated stage progression, SLA timers, forecasting models |
| **Saved views** | Per-object saved views: column selection, sort, filters, view kind (table/kanban), per-member or shared scope | Cross-object dashboards, charts, scheduled exports |
| **Custom fields** | JSONB column per core object + `field_definitions` metadata; types `text, number, boolean, date, single_select, multi_select, url, email`; validation against definitions | Per-tenant DDL, dynamic physical tables, computed/formula fields, rollups, custom-field uniqueness, `datetime`/`currency` field types |
| **API** | Code-first GraphQL (Apollo Server on NestJS); queries/mutations for all in-scope objects; cursor pagination; optimistic-concurrency; auth + RLS-bound resolver context | Public REST API, webhooks, GraphQL subscriptions |
| **Async** | BullMQ + Redis; jobs for transactional email (verify/reset/invite) and soft-delete purge | Workflow execution, AI jobs, billing/metering jobs, imports/exports, view recomputation, search indexing |
| **Frontend** | React + Vite SPA; Apollo Client + GraphQL codegen; Tailwind + shadcn/ui (Radix); TanStack Table; auth flows; CRUD + saved-view UI | Inbox UI, automation canvas, AI chat UI, billing UI |

### 1.5 Architecture at a Glance (scope-setting only; detailed in §2)

- **Monorepo:** pnpm workspaces orchestrated by Turborepo.
  ```
  clevar/
    apps/
      api/        # NestJS + code-first GraphQL (Apollo Server)
      worker/     # NestJS application context (no HTTP); BullMQ processors
      web/        # React + Vite SPA (Apollo Client, Tailwind, shadcn/ui)
    packages/
      db/         # Prisma schema, migrations, generated client, RLS policy SQL, seed
      shared/     # cross-cutting TS types, zod schemas, enums, error codes, tenant helpers
      ui/         # shadcn/ui primitives + Tailwind preset
      config/     # eslint / tsconfig / tailwind presets, typed env loading
  ```
  `apps/api` and `apps/worker` are **two separate deployables** that share the same NestJS domain modules and the same `@clevar/db` Prisma client. They boot differently (HTTP listener vs `createApplicationContext()`) and scale on different axes (request concurrency vs queue depth).
- **Database:** PostgreSQL 16. Every tenant-scoped table carries `workspace_id uuid NOT NULL` and is protected by an RLS policy. Each request opens one transaction and issues `SET LOCAL app.workspace_id`; the app connects as `clevar_app` (`LOGIN NOBYPASSRLS`), so no code path can skip policies.
- **Custom fields:** a `custom_fields jsonb NOT NULL DEFAULT '{}'` column per core object, governed by rows in `field_definitions`. No per-tenant DDL.
- **Auth tokens:** access JWT (15m) carries `{ sub, ws, role, jti }`; refresh token is opaque, rotating, stored hashed (SHA-256), delivered as an httpOnly, Secure, SameSite cookie. Passwords hashed with argon2id.
- **Async:** BullMQ on Redis; workers run in `apps/worker`, sharing types and the Prisma client but scaling independently.

### 1.6 Per-tenant resource ceilings

To bound index/scan cost, abuse, and to give the later billing layer a tightening point without a migration, the service layer enforces generous configurable ceilings (sourced from config now; movable to the workspace record when billing arrives):

| Resource | Default ceiling |
|---|---|
| Workspaces per user | 10 |
| Members per workspace | 200 |
| Custom fields per object | 100 |
| `custom_fields` JSONB byte size per row | 64 KiB |
| Saved views per (object, member) | 100 |
| Outstanding invitations per workspace | 200 |

### 1.7 Success Criteria & Acceptance

**Functional**

- **AC1** A new user can sign up, **verify email**, create a workspace, and land in a CRM with one seeded default pipeline (§4.3).
- **AC2** An owner/admin can invite a teammate by email; the invitee accepts (single-use, expiring token) and joins as a `member`; roles gate the documented operations.
- **AC3** A member can create, read, update, soft-delete, **and restore** contacts, companies, and deals, including relations (contact→company, deal→company/contact, deal→pipeline/stage).
- **AC4** An admin can create a pipeline with ordered stages; a member can move a deal across stages; stage `won`/`lost` types behave as specified.
- **AC5** Notes can be attached to any core object and listed in reverse-chronological order.
- **AC6** A member can define a custom field (e.g. a `single_select` "Lead source") and set/filter on its value; data lives in `custom_fields` JSONB validated against `field_definitions`.
- **AC7** Saved views persist column choice, sort, and filters; switching views re-renders the table; shared vs personal scope is honored.
- **AC8** GraphQL collections paginate with stable cursors and return only the caller's workspace data.

**Isolation & security (hard gates)**

- **AC9 (RLS proof)** A test connecting as `clevar_app` with `app.workspace_id = A` returns zero rows for any object owned by workspace `B`, on read **and** write, including when the application-level filter is deliberately omitted. A second test asserts the role cannot `SET ROLE`/bypass RLS.
- **AC10** With the `SET LOCAL app.workspace_id` binding removed, tenant queries return zero rows (fail-closed), never cross-tenant rows — asserted at the DB layer using a raw `clevar_app` connection with no `SET LOCAL`. The request path additionally rejects such requests upstream; both layers are tested independently.
- **AC11** Access tokens expire at 15 minutes; an expired access token is rejected; a valid refresh cookie mints a new pair and rotates (old refresh token revoked, reuse detected → family revoked).
- **AC12** Passwords stored only as argon2id hashes; refresh tokens only as SHA-256 hashes; no plaintext or reversible secret is persisted or logged.

**Non-functional**

- **NF1** API p95 < 200 ms for single-object reads and < 400 ms for filtered list reads at the reference dataset size, on a single API instance.
- **NF2** API and worker tiers are stateless and pass a horizontal-scale test (N≥3 instances, no sticky sessions).
- **NF3** `pnpm turbo run build typecheck lint test` is green; GraphQL codegen is in sync (CI fails on drift); migrations apply cleanly from empty and `prisma migrate diff --exit-code` passes.
- **NF4** A documented seed produces a demo workspace; a one-command local bring-up works.

### 1.8 Key Terminology

| Term | Definition |
| --- | --- |
| **Workspace** | The tenant; top-level isolation boundary owning members, CRM data, custom fields, pipelines, views. Every tenant-scoped row carries `workspace_id`. "Workspace" and "tenant" are interchangeable. |
| **Member** | A user's membership within a specific workspace, carrying a role. A user can be a member of several workspaces. DB table `workspace_members`; GraphQL type `Member`. |
| **User** | A global identity (email + argon2id hash). |
| **Role** | Workspace-scoped permission level: `owner`, `admin`, `member`. |
| **Object** | A first-class CRM record type — `contact`, `company`, or `deal`. |
| **Record** | A single instance of an object. |
| **Pipeline / Stage** | A named, ordered sequence of stages (name, position, probability 0–100, color, type ∈ `open`/`won`/`lost`) that deals move through. |
| **Note** | A markdown annotation attached to any object record. |
| **Saved view** | A persisted per-object presentation (columns, sort, filters, view kind `table`/`kanban`), scoped personal or shared. |
| **Custom field / Field definition** | A tenant-defined attribute stored in `custom_fields` JSONB, described by a `field_definitions` row. |
| **RLS** | PostgreSQL Row-Level Security — the database-enforced policy guaranteeing tenant isolation regardless of application code. |
| **App role** | The non-superuser login `clevar_app`, created `NOBYPASSRLS` so policies can never be skipped. |

---

## 2. System Architecture

CLEVAR's Foundation is one unified TypeScript monorepo compiling into three deployable artifacts (`apps/api`, `apps/worker`, `apps/web`) sharing one Prisma schema and shared domain libraries. The architecture is **boring at the edges, strict at the core**: stateless HTTP/GraphQL processes in front, a connection-pooled PostgreSQL 16 cluster with RLS as the hard tenant boundary, and Redis as the only stateful coordination layer. Later Chat/AI/Workflow specs attach as new modules and new queues — never as a rewrite of the core.

### 2.1 High-Level Components

```
   Browser (SPA)              EDGE / INGRESS
 ┌──────────────┐  HTTPS    TLS · WAF · sticky-less LB
 │ React + Vite │◄────────► (managed LB / CDN in front)
 │ Apollo Client│              │ POST /graphql   │ /auth/* (REST)
 └──────────────┘              ▼                 ▼
        ▲ refresh cookie   ┌────────────────────────────────────────┐
        │ (httpOnly)       │  API TIER (apps/api — NestJS, N replicas)│
        │                  │  Apollo Server (code-first GraphQL)      │
        │                  │  Resolvers → Services → Prisma           │
        │                  │  Guards: JwtAuthGuard · WorkspaceGuard   │
        │                  │  TenantContextInterceptor (ONE tx + RLS) │
        │                  └───┬──────────────┬──────────────┬────────┘
        │                      │ SQL(pgbouncer)│ enqueue      │ cache/rate-limit
        │                      ▼               ▼              ▼
        │            ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
        │            │ PostgreSQL 16 │  │ Redis 7       │  │ Redis 7       │
        │            │ (managed prim.)│ │ (BullMQ queue)│  │ (cache+limit) │
        │            │ RLS on every   │ └──────┬───────┘  └──────────────┘
        │            │ workspace_id   │        │ reserve job
        │            └───────▲────────┘        ▼
        │                    │ SQL (own RLS tx) ┌──────────────────────────┐
        └────────────────────┴──────────────────│ WORKER TIER (apps/worker) │
                                                 │ BullMQ: emails, soft-     │
                                                 │ delete purge              │
                                                 └──────────────────────────┘
```

| Component | Artifact | Stateless? | Scaling unit | Responsibility (Foundation) |
|---|---|---|---|---|
| Web SPA | `apps/web` | n/a (CDN) | CDN edge | Renders CRM UI; talks to `/graphql` + `/auth/*`. Holds access token in memory only. |
| API server | `apps/api` | Yes | Pod replicas behind LB | GraphQL gateway, auth, RLS-scoped reads/writes |
| Worker | `apps/worker` | Yes | Pod replicas / queue concurrency | Transactional emails, soft-delete purge |
| PostgreSQL 16 | managed primary | No (state) | Vertical (replicas/partitioning later) | System of record; RLS enforces isolation |
| Redis 7 (queues) | managed | No (state) | Cluster/instance | BullMQ transport, delayed jobs, dead-letter |
| Redis 7 (cache) | managed | No (state) | Cluster | Refresh-token revocation list, field-definition cache, rate-limit counters |

Shared packages consumed by `apps/api` and `apps/worker`: `packages/db` (Prisma schema, client, migrations, RLS SQL), `packages/shared` (domain types, zod validators, enums, error codes, the `withTenant` transaction helper and `TenantContext`), `packages/config` (typed env, secrets), and `packages/ui` (consumed by `apps/web`).

> **Forward seam (not shipped):** Later specs introduce a transactional outbox on the same `workspace_id` + RLS pattern (with a dedicated relay reader role) and a `DomainEvent` vocabulary. The Foundation deliberately does **not** ship an outbox table, a `DomainEventBus`, or a relay worker — building a producer with zero consumers is dead infrastructure. The seam is named here so later work attaches without reworking the core, but no schema, code, or queue for it exists in this spec.

### 2.2 Request Lifecycle — one transaction per request

The non-negotiable invariant: **no tenant data is read or written outside a single database transaction per request that first executes `SET LOCAL app.workspace_id`.** The app connects as a non-superuser role without `BYPASSRLS`, so a missing or wrong `app.workspace_id` returns zero rows, never another tenant's rows.

```
1. Browser: POST /graphql, Authorization: Bearer <access JWT, 15m>
   (refresh token is in an httpOnly cookie, not sent here)
2. Ingress LB → any API replica (no sticky sessions)
3. Guard/interceptor chain, per request:
   a. JwtAuthGuard       → verify access JWT; extract { sub, ws, role, jti }
   b. WorkspaceGuard      → assert ws matches a live workspace_members row for sub; load current role
   c. TenantContextInterceptor → open ONE interactive Prisma transaction; SET LOCAL app.workspace_id once
4. Every resolver/service/DataLoader runs INSIDE that single tx (the scoped tx client is
   threaded via AsyncLocalStorage / request scope). RLS filters every statement.
5. Transaction commits (or rolls back atomically on error).
6. Token refresh, if needed, is a separate POST /auth/refresh that reads the httpOnly cookie.
```

The canonical tenant wrapper (`packages/shared/src/tenant/with-tenant.ts`):

```ts
// ONE interactive transaction per request. set_config(name, value, is_local=true) == SET LOCAL.
// The returned tx client is injected into ALL resolvers/services for the request; there is no
// per-operation transaction wrapper, so reads-your-writes and a consistent snapshot hold,
// DataLoader batches stay in one tx, and SET LOCAL is issued exactly once.
export function withTenant<T>(
  prisma: PrismaClient,
  ctx: TenantContext,            // { workspaceId, userId, role }
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.workspace_id', ${ctx.workspaceId}, true)`;
    // Defense-in-depth: refuse to proceed if the GUC did not bind.
    const [{ ws }] = await tx.$queryRaw<{ ws: string | null }[]>`
      SELECT current_setting('app.workspace_id', true) AS ws`;
    if (ws !== ctx.workspaceId) throw new Error('tenant context not bound');
    return work(tx);
  });
}
```

The RLS policy on every tenant-scoped table (one canonical shape, generated per table in `packages/db/prisma/migrations/.../migration.sql`):

```sql
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts FORCE  ROW LEVEL SECURITY;   -- applies even to the table owner

CREATE POLICY contacts_tenant_isolation ON contacts
  USING      (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)   -- read
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);  -- write
```

Key properties:

- **`NULLIF(current_setting('app.workspace_id', true), '')::uuid`** — `missing_ok=true` yields `NULL` for an unset GUC, and `NULLIF(...,'')` tolerates a defensively-empty value; either way the predicate is false → zero rows (fail-closed), never an error that could mask a path.
- **`SET LOCAL` / `set_config(...,true)`** binds the GUC to the transaction, so a pooled connection returned to the pool carries no tenant context — no bleed between tenants.
- **Connection pooling** runs through PgBouncer in **transaction pooling** mode. Because the GUC is `is_local=true` inside an explicit transaction, transaction pooling is safe: the setting cannot escape onto a connection another tenant later borrows. A periodic canary opens a fresh pooled connection and asserts `current_setting('app.workspace_id', true) IS NULL`.
- **Writes** are validated twice: RLS `WITH CHECK` rejects any insert/update whose `workspace_id` differs from the GUC, and a `BEFORE INSERT` trigger overwrites `workspace_id := current_setting('app.workspace_id')::uuid` unconditionally (ignoring any client-supplied value), so clients cannot forge or target another tenant (see §4.2).
- **Custom fields** ride along transparently; `field_definitions` is itself RLS-scoped (§4), so a tenant's custom-field activity never triggers schema migrations or cross-tenant locks.

### 2.3 Stateless API + Horizontal Scaling

The API tier holds **zero per-user state in process memory**:

| State | Where | Why |
|---|---|---|
| Authenticated identity | Stateless access JWT (15m), verified per request | No server-side session lookup on the hot path |
| Refresh / revocation | httpOnly cookie + Redis revocation set (`auth:revoked:<jti>`) | Logout/rotation works across all replicas |
| Field-definition metadata | Redis cache keyed `wsmeta:<workspace_id>`, TTL + event-based bust | Avoids re-reading `field_definitions` every request |
| Rate-limit counters | Redis (sliding window per IP / actor / workspace) | Shared limit across replicas |
| Async work | BullMQ on Redis | Survives API restarts |

Any replica serves any request; the LB needs no sticky sessions. The data tier is the first scaling limit; the design absorbs growth without rework because `workspace_id` leads every secondary index. **Read replicas and `workspace_id` partitioning are NOT shipped in the Foundation** — they are unblocked by the schema and introduced when load requires (a single primary meets NF1/NF2). Graceful shutdown contract (both tiers): on `SIGTERM`, stop accepting new work (LB deregistration for API, `worker.pause()` for worker), drain in-flight transactions/jobs within the grace period, then exit.

### 2.4 Deployment Topology

```
                Internet  HTTPS(443)
          ┌──────────────────────┐
          │  Load Balancer        │  TLS, HTTP/2, WAF, health checks → /graphql, /auth/*
          └───┬──────────────┬────┘
   ┌──────────▼──┐      ┌─────▼───────┐     CDN (static SPA) ── apps/web build
   │ api pod x N │ ...  │ api pod x N │     served from object storage + CDN
   └──────┬──────┘      └──────┬──────┘
          └──────────┬─────────┘
              ┌───────▼────────┐  ┌──────────┐
              │   PgBouncer     │  │ Redis     │
              │ (transaction)   │  │ (managed) │
              └───────┬─────────┘  └──────────┘
              ┌───────▼─────────┐
              │ Managed PG 16   │  PITR backups, encrypted at rest; app role clevar_app
              │ (single primary)│
              └─────────────────┘
              ┌────────────────┐
              │ worker pod x M  │  (no LB; pulls from Redis queues)
              └────────────────┘
```

| Layer | Choice | Notes |
|---|---|---|
| Containers | `clevar-api`, `clevar-worker` images; SPA built to static assets | Same base image, different entrypoint (`node dist/api/main.js` vs `node dist/worker/main.js`) |
| Orchestration | Kubernetes-style managed container platform | API + worker as separate Deployments with independent HPA |
| Database | Managed PostgreSQL 16 (single primary for Foundation) | Encryption at rest, PITR, automated failover; app role is non-superuser `clevar_app` |
| Connection pool | PgBouncer (transaction mode) | Bounds backends; compatible with `SET LOCAL` RLS (see §3.7 connection budget) |
| Cache/queue | Managed Redis 7 (separate logical instances for queues vs cache) | Can collapse to one instance if preferred; isolating queue traffic from cache eviction protects job durability |
| Static delivery | Object storage + CDN | SPA fully static; dynamic calls hit `/graphql` and `/auth/*` |
| Secrets/config | Managed secret store injected as env (`packages/config` validates at boot) | Fail-fast on missing/invalid config |
| Migrations | `prisma migrate deploy` + RLS SQL run as a pre-deploy job (owner role) | Schema and policies versioned together |
| Observability | Structured JSON logs, `/healthz`+`/readyz` probes, no-op OpenTelemetry seam | See §7.7 |

### 2.5 Built to Absorb Chat / AI / Workflow Without Rework

Domain logic is grouped into NestJS feature modules under `apps/api/src/modules/`: Foundation ships `auth`, `workspace`, `crm` (contacts/companies/deals/pipelines/stages/notes), and `views`. Later specs add sibling modules (`inbox`, `agents`, `workflows`) depending on the same `packages/shared` (tenant context, `withTenant`) and Prisma client. No core module imports a later module; later modules depend inward only. The RLS pattern, the `withTenant` wrapper, and the `workspace_id` convention are reused verbatim by any new tenant-scoped table, so a future `conversations` or `runs` table gets isolation for free.

BullMQ is wired in Foundation for its own jobs (emails, soft-delete purge), so queue infrastructure, dead-letter handling, retry/backoff, and worker bootstrap already exist; later modules add new named queues to the same Redis and worker Deployment — a config change, not an architectural one. The code-first GraphQL schema is composed per module, so later specs add types without touching CRM resolvers.

---

## 3. Multi-Tenancy, Auth & Security

CLEVAR is a shared-schema multi-tenant SaaS. Every tenant shares the same database, tables, and Prisma schema. Isolation is **not** achieved by careful `WHERE workspace_id = ?` clauses — one typo from a cross-tenant leak. It is enforced **at the database layer** by PostgreSQL RLS, with application code treated as untrusted with respect to tenancy. Authorization (who-can-do-what *within* a tenant) is a separate, application-layer concern.

**Principle:** *isolation is a database invariant; authorization is an application policy.* If application code forgets a filter, RLS returns zero rows. If RLS is misconfigured, the threat model (§3.8) names the control that catches it.

### Design at a glance

| Concern | Mechanism | Where enforced |
|---|---|---|
| Tenant data isolation | RLS + `workspace_id` on every tenant table | Database (defense floor) |
| Per-request tenant scope | `SET LOCAL app.workspace_id` inside the one request transaction | `apps/api` interceptor / `withTenant` |
| App cannot escape RLS | Runtime role `clevar_app` is non-superuser, **no `BYPASSRLS`** | Database role grants |
| Schema changes | Separate migration role `clevar_migrator` owns tables, runs DDL | CI/CD migration job only |
| Authentication | JWT access (15m) + rotating refresh token in httpOnly cookie; argon2id | `apps/api` auth module |
| Authorization (RBAC) | `owner`/`admin`/`member` membership per workspace | GraphQL guards + service-layer policies |

### 3.1 `workspace_id` on every tenant-scoped table

Every tenant table carries a non-null `workspace_id uuid` with an FK to `workspaces(id)`. The **only** non-RLS global tables are `users`, `workspaces`, `workspace_members`, `refresh_tokens`, `invitations`, `email_verification_tokens`, and `password_reset_tokens` (explicitly enumerated and reviewed). **`field_definitions` IS a tenant-plane, RLS-protected table** (it carries `workspace_id`, is read on the hot custom-field validation path, and its cache key is per workspace).

`workspace_members` and the token/invitation tables are deliberately **not** RLS-protected because they must be read *before* `app.workspace_id` is bound (membership lookup in `WorkspaceGuard`; token lookup before the acceptor is a member). This avoids a bootstrap chicken-and-egg and is the reviewed allowlist the T11 CI guard (§3.8) checks against.

Two deliberate choices on the tenant key (uniform across the authoritative schema in §4):

- **`workspace_id` is never written by the application.** A `BEFORE INSERT` trigger sets `workspace_id := current_setting('app.workspace_id')::uuid`, overriding any client value, so a buggy resolver cannot target another tenant. RLS `WITH CHECK` is the second guard.
- **Every secondary index leads with `workspace_id`**, keeping the planner on index scans and preventing tenant-wide sequential scans.

### 3.2 Enabling RLS and policy SQL

RLS is `ENABLE`d and `FORCE`d on every tenant table. `FORCE` is essential: without it, the table owner (the migration role) bypasses policies. These statements live in hand-authored, version-controlled SQL migrations applied by the migrator role (Prisma has no RLS DSL). The canonical policy shape is in §2.2.

- The `NULLIF(current_setting('app.workspace_id', true), '')::uuid` form fails closed for both unset and empty GUC values; an unscoped connection sees zero rows.
- One policy with both `USING` and `WITH CHECK` covers `SELECT/INSERT/UPDATE/DELETE`, minimizing drift surface.
- `app.workspace_id` is a custom GUC namespace; no `postgresql.conf` registration is needed for `set_config` of a namespaced parameter.

### 3.3 The non-superuser, non-`BYPASSRLS` application role

```sql
CREATE ROLE clevar_app LOGIN PASSWORD :secret
  NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;   -- canonical, used everywhere
GRANT CONNECT ON DATABASE clevar TO clevar_app;
GRANT USAGE  ON SCHEMA public    TO clevar_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO clevar_app;  -- DML only, no DDL
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO clevar_app;
```

- **`NOSUPERUSER` + `NOBYPASSRLS`** — these attributes silently skip all policies; stripping both makes RLS non-optional. `clevar_app` does **not** own the tables (ownership stays with `clevar_migrator`), and `FORCE RLS` then applies policies to `clevar_app` regardless.
- **Boot-time self-check:** `apps/api` and `apps/worker` query `pg_roles` for `rolsuper`/`rolbypassrls` on their own role *and* assert the role is not a member of any superuser/`BYPASSRLS`-bearing role (inheritance can re-grant it); the process refuses to start otherwise.

### 3.4 Migration role separation

```sql
CREATE ROLE clevar_migrator LOGIN PASSWORD :secret NOSUPERUSER NOBYPASSRLS;  -- owner; FORCE RLS still applies
GRANT ALL ON SCHEMA public TO clevar_migrator;
```

| Role | LOGIN | SUPERUSER | BYPASSRLS | Owns tables | DDL | Used by |
|---|---|---|---|---|---|---|
| `clevar_migrator` | yes | no | no | yes | yes | `prisma migrate deploy` in CI/CD only (via `DATABASE_MIGRATION_URL`) |
| `clevar_app` | yes | no | **no** | no | no | `apps/api` request path + `apps/worker` |

`DATABASE_MIGRATION_URL` is present only in CI/CD and never injected into running pods. A compromised app process has no DDL capability — it cannot disable RLS, drop a policy, or add a `BYPASSRLS` role.

### 3.5 The Prisma tenant client (single request transaction)

There is **one** mechanism, the `withTenant` request-scoped interactive transaction (§2.2), created once in `TenantContextInterceptor` and threaded to every resolver/service via request scope / `AsyncLocalStorage`. There is **no** per-operation `$transaction`-wrapping client extension — that pattern would break read-your-writes, split DataLoader batches across transactions, and multiply `SET LOCAL` round-trips. Resolvers receive only the scoped `tx` client; they have no other Prisma handle, so an unscoped query cannot happen by accident.

DataLoader is per-request and uses the scoped `tx` client, so batched relation loads (e.g. `Company.contacts`, `Deal.company`) run inside the same RLS transaction and cannot escape isolation.

A separate **`adminClient`** (the un-scoped base client) is used only for genuinely global tables, restricted to a dedicated repository that physically cannot reference tenant models (compile-time allowlist: `users`, `workspaces`, `workspace_members`, `refresh_tokens`, and the global token tables). It is forbidden on any tenant table. `me`/`myWorkspaces` query `workspace_members` filtered strictly by the signature-verified `sub`.

### 3.6 Invitations and pre-membership reads

The invite/accept and token flows must read rows before the actor is a member. To keep RLS the floor without an un-RLS'd tenant path, `invitations`, `email_verification_tokens`, and `password_reset_tokens` are **global, RLS-exempt token tables** keyed by `token_hash`, each carrying `workspace_id`/`user_id` as data. They are reached only through the dedicated `adminClient` repository with explicit `WHERE token_hash = $1`. On `acceptInvite`, the server reads `workspace_id` and `role` **from the invitation row** (never from client input), then binds `app.workspace_id` from that value to create the `workspace_members` row inside a normal tenant transaction.

### 3.7 Connection pooling caveat and budget

`SET LOCAL` is transaction-scoped, which is exactly what makes it safe under PgBouncer transaction-pooling: the GUC is set and consumed within one transaction and cleared at COMMIT before the connection is returned. The danger of `SET SESSION` leaking onto a pooled connection is avoided because only `SET LOCAL`/`set_config(local=true)` is used and config+query are in one transaction. As a defense (not just lint), `withTenant` asserts the GUC bound (§2.2), and a canary checks fresh connections carry no leaked GUC.

The real caveat is **prepared statements**: transaction mode requires `?pgbouncer=true` (disables named prepared statements). Migrations use a `directUrl` (pooler bypassed) for advisory locks and DDL.

```prisma
datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")            // clevar_app via PgBouncer (transaction mode)
  directUrl = env("DATABASE_MIGRATION_URL")  // clevar_migrator, pooler bypassed
}
```

**Connection budget.** Each in-flight interactive transaction pins one server backend for its lifetime. Per-replica Prisma `connection_limit` (`DATABASE_POOL_MAX`, default 10) governs Prisma's pool to PgBouncer, not Postgres backends directly. The budget is: *max concurrent interactive transactions = replicas × pool size*, which must stay under PgBouncer's server pool and Postgres `max_connections`. Resolver chains hold the connection for their whole duration, so transactions are kept short. Never use `connection_limit=1` (it throttles concurrency to one in-flight tx per replica).

Rules enforced: never set the GUC outside a transaction (lint-banned `SET SESSION`, all DB access routed through `withTenant`/`adminClient`); migrations use `directUrl`; `apps/worker` follows the identical `withTenant` pattern — a job carries `workspaceId` in its payload, opens its own scoped tenant transaction, and is subject to the same `clevar_app` role + RLS. There is no privileged background path.

### 3.8 Authentication design

#### Credentials and token model

- **Password hashing:** argon2id (`@node-rs/argon2`), starting at `memoryCost: 19456 KiB, timeCost: 2, parallelism: 1`, calibrated to a single canonical **~150 ms** target on production hardware. Hashes carry their parameters, so cost can be raised and old hashes upgraded on next successful login.
- **Access token:** JWT, **15-minute** TTL, signed HS256 (shared secret; RS256 later if signing/verification split). Stateless; canonical claims `{ sub: userId, ws: workspaceId, role, jti }`. Sent as `Authorization: Bearer`, verified every request.
- **Refresh token:** opaque, high-entropy random (256-bit), stored **hashed with SHA-256** (sufficient given entropy; no pepper needed). Delivered only in an httpOnly, Secure, **SameSite=Strict** cookie named `clevar_rt`, scoped `Path=/auth`. Never readable by JS, never in localStorage. TTL 30 days (sliding via rotation).

`refresh_tokens` (global, no RLS — keyed by user; columns per §4.3.4). Rotation is atomic: `UPDATE ... WHERE token_hash=$1 AND revoked_at IS NULL RETURNING ...` to avoid a double-refresh race.

#### Cross-origin auth and CSRF (canonical resolution)

The SPA is served from a CDN origin and the API from a separate host. To make `SameSite=Strict` refresh cookies work, **SPA and API are deployed under one registrable domain** (e.g. `app.clevar.com` and `api.clevar.com`); the refresh cookie is set with the parent domain so cross-subdomain XHR sends it. CORS allows exactly the SPA origin(s) (`CORS_ALLOWED_ORIGINS`) with `credentials: 'include'`. `/auth/refresh` and `/auth/logout` are POST-only and same-site; given `SameSite=Strict; Path=/auth; HttpOnly; Secure`, CSRF surface is minimal. The invite-accept link lands on an unauthenticated SPA page that performs a same-site POST to `/auth/accept-invite`, so Strict does not block it. If a future deployment must place SPA and API on unrelated sites, switch the cookie to `SameSite=None; Secure` plus a double-submit CSRF token.

#### The flows

| Flow | Operation | Behavior |
|---|---|---|
| **Signup** | `POST /auth/signup` | argon2id-hash password; create `users` (unverified); enqueue verification email; create `workspaces` + `workspace_members` (role `owner`) + seeded default pipeline; issue access JWT + set refresh cookie. To avoid an email-enumeration oracle, a pre-existing email returns a generic success and an out-of-band "you already have an account" email rather than a synchronous conflict. |
| **Verify email** | `POST /auth/verify-email { token }` | Validate single-use `email_verification_tokens` row by `token_hash`; set `users.email_verified_at`; consume token. |
| **Login** | `POST /auth/login` | Constant-time lookup by email via `adminClient`; argon2id verify; issue access + refresh; choose default workspace. Generic failure message for unknown-email vs bad-password. |
| **Refresh** | `POST /auth/refresh` (cookie only; optional `{ workspaceId }`) | Validate cookie token against stored hash; if valid/unexpired/unrevoked → rotate; mint new access JWT. The optional `workspaceId` re-mints a token scoped to a different membership after verifying active membership. This is the single canonical workspace-switch mechanism (no `switchWorkspace` GraphQL mutation). |
| **Logout** | `POST /auth/logout` | Revoke current refresh token; add `jti` to Redis revocation set; clear cookie. |
| **Request reset** | `POST /auth/request-password-reset { email }` | Always generic success; if account exists, enqueue email with single-use `password_reset_tokens` link. |
| **Reset** | `POST /auth/reset-password { token, password }` | Validate token by `token_hash`; set new argon2id hash; consume token; revoke all refresh-token families for the user. |
| **Accept invite** | `POST /auth/accept-invite { token, password?, fullName? }` (REST, unauthenticated path) or `acceptInvite(input)` mutation (authenticated existing user) | Read `workspace_id` + `role` from the server-side `invitations` row by `token_hash` (single-use, expiry-checked); create the membership. |

#### Refresh-token rotation + reuse detection

Every successful refresh invalidates the presented token and issues a new one in the same `family_id` lineage (`replaced_by` chains old→new). Reuse detection: lookup by `token_hash`; if found AND (`revoked_at IS NOT NULL` OR `replaced_by IS NOT NULL`) → revoke the entire `family_id` and 401. httpOnly (XSS cannot read), hashed at rest (a DB dump yields no usable tokens), single-use rotation with family-wide revoke on reuse (stolen-token replay self-destructs the family).

### 3.9 RBAC (owner / admin / member)

Roles are workspace-scoped attributes on `workspace_members`, not global user attributes. A user can be `owner` of A and `member` of B.

| Capability | owner | admin | member |
|---|---|---|---|
| Read/write CRM records (contacts, companies, deals, notes) | yes | yes | yes |
| **Move a deal across stages (`moveDealToStage`/`setDealStatus`)** | yes | yes | yes (deal data, not pipeline structure) |
| Create/edit/delete pipelines & stages | yes | yes | no |
| Create/edit shared saved views & field definitions | yes | yes | no (own private views only) |
| Invite / remove members, change roles | yes | yes (cannot touch owners) | no |
| Transfer ownership, delete workspace | yes | no | no |

Multiple owners are permitted. Guard rules, enforced in the service layer within the mutation transaction: only an owner may create/promote-to/demote/remove owners; an admin cannot modify any owner row nor promote anyone to owner; no member may change their own role. "At least one owner remains" is enforced robustly against races by `SELECT ... FOR UPDATE` on the workspace's owner rows within the tx, failing if the post-change owner count would be zero. `acceptInvite` reads role from the server-side invitation row, never from client input.

Where authorization is enforced (layered):

1. **`JwtAuthGuard`** — validates signature/expiry; rejects anonymous requests.
2. **`WorkspaceGuard`** — confirms `ws` corresponds to a live `workspace_members` row for `sub` **on every request** (a removed member loses access within the ≤15 min token window; see Open Questions), loads the *current* role from the DB (not trusting the token's `role` claim for sensitive mutations), and finalizes `app.workspace_id`.
3. **`@RequireRole(...)` + `RolesGuard`** — coarse, declarative capability gates.
4. **Service-layer policy** — finer rules (e.g. a `member` may edit only their own private saved views).
5. **RLS underneath all of it** — even if guards 1–4 were bypassed, a query cannot leave the active tenant.

*RBAC decides what actions a member may take within their tenant; RLS decides which tenant's rows exist at all for the connection.* A privilege-escalation bug in RBAC is a within-tenant problem; it can never become a cross-tenant breach.

### 3.10 Data-handling / PII posture

The CRM stores personal data (names, emails, phones). Posture: **do not log record field values** — logs and trace span attributes carry only `requestId`, `workspaceId`, `userId`, and resource ids, never PII. The pino redaction list (§7.7) covers `password`, `authorization`, `cookie`, `*.token`; field-value logging is prohibited by convention and code review. The erasure path is the workspace cascade (`ON DELETE CASCADE` from `workspaces`) plus the soft-delete purge job; backups inherit deletion on their retention rollover.

### 3.11 XSS / supply-chain hardening

Because the security model leans on "access token in memory, refresh httpOnly," an XSS that runs in the page could still call `/graphql` with the in-memory token. Mitigations: a strict Content-Security-Policy (no inline scripts; `script-src 'self'`), Trusted Types where supported, Subresource Integrity on CDN assets, and dependency/supply-chain scanning in CI (`gitleaks` for secrets, lockfile audit). GraphQL introspection is disabled in production; alias-based field duplication and many-`node(id:)` lookups are bounded by the complexity/depth limits (§5.5).

### 3.12 Threat model: tenant-isolation failure modes

| # | Failure mode | Control |
|---|---|---|
| T1 | Resolver forgets `WHERE workspace_id` | RLS auto-applies the predicate; app filters are redundant, not load-bearing. |
| T2 | GUC never set on a connection | Unset/empty GUC → NULL → no rows. **Fail closed.** |
| T3 | Runtime connects as superuser / `BYPASSRLS` role | `clevar_app` is `NOSUPERUSER NOBYPASSRLS`; boot self-check refuses to start otherwise (incl. role inheritance). |
| T4 | Table owner bypasses its own policy | `FORCE ROW LEVEL SECURITY`; owner (`clevar_migrator`) is itself subject to policies. |
| T5 | `SET SESSION` leaks tenant onto pooled connection | Only `SET LOCAL`/`set_config(local=true)` in a tx; GUC clears at COMMIT; canary asserts fresh connections are clean; `SET SESSION` lint-banned. |
| T6 | Client supplies/forges `workspace_id` on insert | `BEFORE INSERT` trigger overwrites it from the GUC; RLS `WITH CHECK` rejects mismatches. |
| T7 | User requests a workspace they don't belong to | `WorkspaceGuard` verifies a live `workspace_members` row before the GUC binds; no membership → no GUC → T2. |
| T8 | Background job runs without tenant context | Jobs carry `workspaceId`; worker opens the same `withTenant` tx; same role + RLS. |
| T9 | Migration disables RLS or adds a `BYPASSRLS` role | DDL only via `clevar_migrator` in CI/CD; app has no DDL grant; RLS presence asserted by T11. |
| T10 | Stolen refresh token replayed | httpOnly+Secure cookie, hashed at rest, single-use rotation, family-wide revoke on reuse. |
| T11 | New tenant table ships without RLS | CI guard enumerates tables with a `workspace_id` column and asserts each (minus the reviewed global-table allowlist: `users`, `workspaces`, `workspace_members`, `refresh_tokens`, `invitations`, `email_verification_tokens`, `password_reset_tokens`) has RLS enabled + forced + a `tenant_isolation` policy; build fails otherwise. A second test seeds two workspaces and asserts tenant A's connection sees zero of B's rows for every model. |
| T12 | JWT forged / role claim tampered | Signature-verified; sensitive mutations re-read role from `workspace_members`. |
| T13 | GUC / JSONB-key injection via crafted input | `workspaceId` parameterized into `set_config` and cast `::uuid`; custom-field keys validated against `field_definitions` and bound as parameters to `->>` (never interpolated), charset `^[a-z][a-z0-9_]*$`. |
| T14 | Cross-tenant/cross-aggregate IDOR via FK inputs | Composite FKs include `workspace_id` (deals→stages, deals→pipelines); a trigger checks `stage.pipeline_id = deal.pipeline_id`; note `parent_id` integrity trigger verifies same-workspace, not soft-deleted; `owner_id` is a composite FK to `workspace_members(workspace_id, user_id)`. See §4. |

---

## 4. Data Model

This section is the authoritative persistence layer: a shared-schema, multi-tenant PostgreSQL 16 database governed by RLS. It defines the **control plane** (global, non-RLS tables) and the **tenant plane** (workspace-scoped tables under RLS). All tables live in one Prisma schema at `packages/db/prisma/schema.prisma`; RLS policies, triggers, and specialized indexes are authored as raw SQL appended to the relevant Prisma `migration.sql` (applied and tracked by `prisma migrate`).

### 4.1 Cross-cutting conventions

| Concern | Decision |
|---|---|
| Primary keys | `uuid` generated as **UUID v7** in the database via a v7 SQL function used as the column default, so time-ordered index locality is guaranteed regardless of caller (no silent mix of v4/v7). The app may also pass an explicit v7 id via a `newId()` helper; both paths produce v7. |
| Audit columns | Every table: `created_at timestamptz NOT NULL DEFAULT now()`, `updated_at timestamptz NOT NULL DEFAULT now()`. **`updated_at` is maintained solely by a `set_updated_at()` BEFORE UPDATE trigger** (authoritative even for raw SQL); Prisma models map it as a plain `DateTime` (no `@updatedAt`) to avoid double-writes. |
| Optimistic concurrency | Mutable records carry `version int NOT NULL DEFAULT 0`, incremented by the same `set_updated_at()` trigger. Update mutations accept an `expectedVersion`; a mismatch raises `CONFLICT`. This is the conflict-resolution seam future automated writers (AI/workflows) participate in. |
| Soft delete | Tenant-scoped business objects carry `deleted_at timestamptz NULL`. Reads filter `deleted_at IS NULL` by default in the repository layer; an `includeDeleted` option surfaces archived rows to owner/admin. Hard purge is a BullMQ job. Saved views, memberships, and refresh tokens are hard-deleted/revoked. |
| Tenant column | Every tenant-scoped table carries `workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE`, set by a `BEFORE INSERT` trigger from the GUC, and is the leading column of every secondary index. |
| Custom fields | One `custom_fields jsonb NOT NULL DEFAULT '{}'` column per core object, validated against `field_definitions`. Never per-tenant DDL, never runtime DDL. |
| Money | `numeric(18,2)` + a separate `currency char(3)` (ISO 4217). Never floats, never integer-minor-units. |
| Naming | `snake_case` in Postgres; Prisma `@@map`/`@map` to `camelCase` TS. |

### 4.2 RLS enforcement and the workspace_id trigger

The app connects as `clevar_app` (no `BYPASSRLS`). One transaction per request issues `SET LOCAL` (§2.2), and the canonical policy (§2.2) scopes every statement. A `BEFORE INSERT` trigger on every tenant table guarantees `workspace_id` comes from the GUC:

```sql
CREATE OR REPLACE FUNCTION set_workspace_id() RETURNS trigger AS $$
BEGIN
  NEW.workspace_id := current_setting('app.workspace_id')::uuid;  -- ignores any client value
  RETURN NEW;
END $$ LANGUAGE plpgsql;
-- attached BEFORE INSERT to companies, contacts, pipelines, stages, deals, notes, saved_views, field_definitions
```

`field_definitions` IS a tenant-plane RLS table. Control-plane tables (`users`, `workspaces`, `workspace_members`, `refresh_tokens`, `invitations`, `email_verification_tokens`, `password_reset_tokens`) are not RLS and are reached only via the `adminClient` repository.

### 4.3 Control plane (global, NOT workspace-scoped, NOT RLS)

#### 4.3.1 `users`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | UUID v7 default |
| `email` | `citext` NOT NULL | case-insensitive; **UNIQUE** |
| `email_verified_at` | `timestamptz` NULL | |
| `password_hash` | `text` NULL | argon2id encoded string |
| `full_name` | `text` NOT NULL | |
| `avatar_url` | `text` NULL | |
| `last_login_at` | `timestamptz` NULL | |
| `is_active` | `boolean` NOT NULL DEFAULT true | soft-deactivate |
| `created_at` / `updated_at` | `timestamptz` | |

Indexes: `UNIQUE (email)`; partial index `WHERE is_active`.

#### 4.3.2 `workspaces`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | equals `app.workspace_id` |
| `name` | `text` NOT NULL | |
| `slug` | `citext` NOT NULL | **UNIQUE**, global, non-secret URL handle (signup gated by rate limiting to deter tenant enumeration) |
| `created_by` | `uuid` NULL FK → `users(id)` ON DELETE SET NULL | |
| `created_at` / `updated_at` / `deleted_at` | `timestamptz` | soft-delete gates tenant access; hard teardown is the `ON DELETE CASCADE` purge |

#### 4.3.3 `workspace_members`

The authorization spine. **Not RLS-protected** (must be read before tenant context binds).

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `workspace_id` | `uuid` NOT NULL FK → `workspaces(id)` ON DELETE CASCADE | |
| `user_id` | `uuid` NOT NULL FK → `users(id)` ON DELETE CASCADE | |
| `role` | `workspace_role` enum NOT NULL DEFAULT `'member'` | |
| `status` | `member_status` enum NOT NULL DEFAULT `'active'` | `active` \| `invited` \| `suspended` |
| `invited_by` | `uuid` NULL FK → `users(id)` | |
| `joined_at` | `timestamptz` NULL | |
| `created_at` / `updated_at` | `timestamptz` | |

Indexes: `UNIQUE (workspace_id, user_id)`; `INDEX (user_id)` for "my workspaces". Multiple owners allowed; ≥1 owner enforced in-tx (§3.9).

#### 4.3.4 `refresh_tokens`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | unrelated to any JWT jti |
| `user_id` | `uuid` NOT NULL FK → `users(id)` ON DELETE CASCADE | |
| `token_hash` | `text` NOT NULL | **SHA-256** of the opaque 256-bit token; raw token never stored |
| `family_id` | `uuid` NOT NULL | rotation lineage; reuse revokes the family |
| `expires_at` | `timestamptz` NOT NULL | ~30 days |
| `revoked_at` | `timestamptz` NULL | |
| `replaced_by` | `uuid` NULL FK → `refresh_tokens(id)` | rotation chain |
| `user_agent` / `ip` | `text` / `inet` NULL | session attribution |
| `created_at` | `timestamptz` | |

Indexes: `UNIQUE (token_hash)`; `INDEX (user_id)`; `INDEX (family_id)`; `INDEX (expires_at)` for the sweep job.

#### 4.3.5 `invitations`, `email_verification_tokens`, `password_reset_tokens`

Global, RLS-exempt token tables read by `token_hash` via `adminClient` before the actor is a member (§3.6).

`invitations`: `id`, `workspace_id` (data, not GUC-bound), `email citext`, `role workspace_role`, `token_hash text UNIQUE`, `expires_at timestamptz`, `invited_by uuid`, `accepted_at timestamptz NULL`, `created_at`. Index `(workspace_id)`, `(email)`.

`email_verification_tokens` / `password_reset_tokens`: `id`, `user_id uuid FK`, `token_hash text UNIQUE`, `expires_at timestamptz`, `consumed_at timestamptz NULL`, `created_at`. Single-use, expiry-checked.

#### 4.3.6 `field_definitions` (tenant plane, **RLS-protected**)

Metadata-lite registry driving `custom_fields`. Carries `workspace_id` and is under the standard RLS policy and `BEFORE INSERT` trigger.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `workspace_id` | `uuid` NOT NULL FK | RLS key |
| `object_type` | `object_type` enum NOT NULL | `company` \| `contact` \| `deal` |
| `key` | `text` NOT NULL | JSON key; `^[a-z][a-z0-9_]*$` |
| `label` | `text` NOT NULL | |
| `data_type` | `field_data_type` enum NOT NULL | `text` \| `number` \| `boolean` \| `date` \| `single_select` \| `multi_select` \| `url` \| `email` |
| `options` | `jsonb` NOT NULL DEFAULT `'[]'` | `[{value,label,color}]` for select types |
| `is_required` | `boolean` NOT NULL DEFAULT false | |
| `position` | `int` NOT NULL DEFAULT 0 | |
| `is_active` | `boolean` NOT NULL DEFAULT true | archive instead of drop (preserves stored values) |
| `created_at` / `updated_at` | `timestamptz` | |

Index: `UNIQUE (workspace_id, object_type, key)`.

**Custom fields end to end:** (1) a definition declares `{object_type, key, data_type, options, is_required}`. (2) Writes to e.g. `contacts.custom_fields` are validated server-side against active definitions for `(workspace_id, 'contact')` — type coercion, required, option-membership, and the §1.6 JSONB byte cap — in `apps/api/src/modules/crm/custom-fields/custom-fields.validator.ts`. (3) Filtering uses JSONB operators (`custom_fields ->> $key`, key bound as a parameter and validated against `field_definitions`), accelerated by a per-object GIN index `USING gin (custom_fields jsonb_path_ops)`. **Custom-field uniqueness is out of scope** (no per-field expression indexes; no runtime DDL — the app role cannot issue DDL and per-tenant DDL is a locked non-goal).

#### 4.3.7 Default pipeline at signup

Every new workspace is seeded **by the system** during workspace creation (the creator is `owner`, so no role conflict) with one default pipeline `Sales` and stages `Lead → Qualified → Proposal` (`open`), `Won` (`won`), `Lost` (`lost`), so AC1's "land in a CRM" and AC3/AC4's deal-creation prerequisites hold without a manual first step.

### 4.4 Tenant plane (workspace_id + RLS)

All tables below: UUID v7 PK, `workspace_id` (trigger-set), `custom_fields jsonb` where a core object, the audit/`version`/soft-delete columns, and RLS enabled+forced (§4.2). Composite FKs that include `workspace_id` enforce same-tenant relations at the DB.

#### 4.4.1 `companies`

Columns: `id`, `workspace_id`, `name text NOT NULL`, `domain citext NULL`, `industry text NULL`, `employee_count int NULL`, `annual_revenue numeric(18,2) NULL`, `address jsonb NOT NULL DEFAULT '{}'`, `owner_id uuid NULL` (composite FK → `workspace_members(workspace_id, user_id)`, account owner must be a member of the same workspace), `custom_fields jsonb`, `version`, audit + `deleted_at`.

Indexes: `INDEX (workspace_id, created_at, id)` (default cursor sort); `INDEX (workspace_id, name)`; partial `UNIQUE (workspace_id, domain) WHERE deleted_at IS NULL AND domain IS NOT NULL`; `INDEX (workspace_id, owner_id)`; `GIN (custom_fields jsonb_path_ops)`.

#### 4.4.2 `contacts`

Columns: `id`, `workspace_id`, `company_id uuid NULL` (composite FK → `companies(workspace_id, id)` ON DELETE SET NULL), `first_name text NULL`, `last_name text NULL`, `email citext NULL`, `phone text NULL` (E.164), `job_title text NULL`, `owner_id` (composite FK → `workspace_members(workspace_id, user_id)`), `custom_fields jsonb`, `version`, audit + `deleted_at`.

Indexes: `INDEX (workspace_id, created_at, id)`; `INDEX (workspace_id, last_name, first_name)`; partial `UNIQUE (workspace_id, email) WHERE deleted_at IS NULL AND email IS NOT NULL`; `INDEX (workspace_id, company_id)`; `INDEX (workspace_id, owner_id)`; `GIN (custom_fields jsonb_path_ops)`.

#### 4.4.3 `pipelines`

Columns: `id`, `workspace_id`, `name text NOT NULL`, `is_default boolean NOT NULL DEFAULT false`, `position int NOT NULL DEFAULT 0`, `version`, audit + `deleted_at`.

Indexes: `INDEX (workspace_id, position)`; partial `UNIQUE (workspace_id) WHERE is_default`.

#### 4.4.4 `stages`

Columns: `id`, `workspace_id`, `pipeline_id uuid NOT NULL` (composite FK → `pipelines(workspace_id, id)` ON DELETE CASCADE), `name text NOT NULL`, `position int NOT NULL`, `probability smallint NOT NULL DEFAULT 0` (0–100), `color text NULL` (badge color), `stage_type stage_type NOT NULL DEFAULT 'open'` (`open`/`won`/`lost`), `version`, audit + `deleted_at`.

Indexes: `UNIQUE (workspace_id, pipeline_id, position) DEFERRABLE INITIALLY IMMEDIATE` (so a `reorderStages` mutation can `SET CONSTRAINTS DEFERRED` and swap positions mid-transaction); `INDEX (workspace_id, pipeline_id)`. Deleting a stage that holds deals is `RESTRICT` — deals must be moved first.

#### 4.4.5 `deals`

Columns: `id`, `workspace_id`, `pipeline_id uuid NOT NULL` (composite FK → `pipelines(workspace_id, id)` ON DELETE RESTRICT), `stage_id uuid NOT NULL` (composite FK → `stages(workspace_id, id)` ON DELETE RESTRICT; a trigger enforces `stage.pipeline_id = deal.pipeline_id`), `company_id uuid NULL` (composite FK → `companies(workspace_id, id)` ON DELETE SET NULL), `primary_contact_id uuid NULL` (composite FK → `contacts(workspace_id, id)` ON DELETE SET NULL), `title text NOT NULL`, `amount numeric(18,2) NULL`, `currency char(3) NOT NULL DEFAULT 'USD'`, `status deal_status NOT NULL DEFAULT 'open'` (derived from stage's `stage_type` on transition, denormalized for forecast queries), `expected_close_date date NULL`, `closed_at timestamptz NULL`, `owner_id` (composite FK → `workspace_members(workspace_id, user_id)`), `custom_fields jsonb`, `version`, audit + `deleted_at`.

Indexes: `INDEX (workspace_id, created_at, id)`; `INDEX (workspace_id, pipeline_id, stage_id)` for board rendering; `INDEX (workspace_id, status, expected_close_date)`; `INDEX (workspace_id, owner_id)`; `INDEX (workspace_id, company_id)`; `GIN (custom_fields jsonb_path_ops)`. (Intra-stage manual reorder is a deferred board-polish item; no fractional `position` column ships in the Foundation.)

#### 4.4.6 `notes` (polymorphic attach)

Markdown notes attachable to any core object. No `custom_fields`.

Columns: `id`, `workspace_id`, `parent_type note_parent_type NOT NULL` (`company`/`contact`/`deal`), `parent_id uuid NOT NULL` (logical FK; an `AFTER INSERT/UPDATE` trigger verifies the parent exists, is not soft-deleted, and shares `workspace_id`), `body text NOT NULL` (markdown), `author_id uuid NULL` (FK → `users(id)` ON DELETE SET NULL — **nullable** to match SET NULL), `version`, audit + `deleted_at`.

Indexes: `INDEX (workspace_id, parent_type, parent_id, created_at DESC)` (the notes-timeline path); `INDEX (workspace_id, author_id)`.

#### 4.4.7 `saved_views`

Per-user or shared filter/sort/column presets. Hard-deleted (no `deleted_at`).

Columns: `id`, `workspace_id`, `object_type object_type NOT NULL`, `name text NOT NULL`, `view_kind view_kind NOT NULL DEFAULT 'table'` (`table`/`kanban`), `filters jsonb NOT NULL DEFAULT '[]'`, `sort jsonb NOT NULL DEFAULT '[]'`, `visible_columns jsonb NOT NULL DEFAULT '[]'`, `is_shared boolean NOT NULL DEFAULT false`, `owner_id uuid NOT NULL FK → users(id) ON DELETE CASCADE`, `position int NOT NULL DEFAULT 0`, audit.

Indexes: `INDEX (workspace_id, object_type, owner_id)`; `INDEX (workspace_id, object_type) WHERE is_shared`.

### 4.5 Enums

| Enum | Values (DB lower_case ↔ GraphQL UPPER_CASE) |
|---|---|
| `workspace_role` | `owner`, `admin`, `member` |
| `member_status` | `active`, `invited`, `suspended` |
| `object_type` | `company`, `contact`, `deal` |
| `field_data_type` | `text`, `number`, `boolean`, `date`, `single_select`, `multi_select`, `url`, `email` |
| `stage_type` | `open`, `won`, `lost` |
| `deal_status` | `open`, `won`, `lost` |
| `note_parent_type` | `company`, `contact`, `deal` |
| `view_kind` | `table`, `kanban` |

### 4.6 Prisma schema sketch (`packages/db/prisma/schema.prisma`)

```prisma
generator client { provider = "prisma-client-js"; previewFeatures = ["postgresqlExtensions"] }
datasource db {
  provider   = "postgresql"
  url        = env("DATABASE_URL")           // clevar_app (no BYPASSRLS), PgBouncer tx mode
  directUrl  = env("DATABASE_MIGRATION_URL") // clevar_migrator, pooler bypassed
  extensions = [citext, pgcrypto]
}

// ---------- CONTROL PLANE (no RLS) ----------
model User {
  id              String   @id @default(dbgenerated("uuid_generate_v7()")) @db.Uuid
  email           String   @unique @db.Citext
  emailVerifiedAt DateTime? @map("email_verified_at") @db.Timestamptz
  passwordHash    String?  @map("password_hash")
  fullName        String   @map("full_name")
  avatarUrl       String?  @map("avatar_url")
  lastLoginAt     DateTime? @map("last_login_at") @db.Timestamptz
  isActive        Boolean  @default(true) @map("is_active")
  createdAt       DateTime @default(now()) @map("created_at") @db.Timestamptz
  updatedAt       DateTime @default(now()) @map("updated_at") @db.Timestamptz  // trigger-maintained
  members         WorkspaceMember[]
  refreshTokens   RefreshToken[]
  @@map("users")
}

model Workspace {
  id        String    @id @default(dbgenerated("uuid_generate_v7()")) @db.Uuid
  name      String
  slug      String    @unique @db.Citext
  createdBy String?   @map("created_by") @db.Uuid
  createdAt DateTime  @default(now()) @map("created_at") @db.Timestamptz
  updatedAt DateTime  @default(now()) @map("updated_at") @db.Timestamptz
  deletedAt DateTime? @map("deleted_at") @db.Timestamptz
  members   WorkspaceMember[]
  companies Company[]
  contacts  Contact[]
  pipelines Pipeline[]
  deals     Deal[]
  @@map("workspaces")
}

model WorkspaceMember {
  id          String        @id @default(dbgenerated("uuid_generate_v7()")) @db.Uuid
  workspaceId String        @map("workspace_id") @db.Uuid
  userId      String        @map("user_id") @db.Uuid
  role        WorkspaceRole @default(member)
  status      MemberStatus  @default(active)
  invitedBy   String?       @map("invited_by") @db.Uuid
  joinedAt    DateTime?     @map("joined_at") @db.Timestamptz
  createdAt   DateTime      @default(now()) @map("created_at") @db.Timestamptz
  updatedAt   DateTime      @default(now()) @map("updated_at") @db.Timestamptz
  workspace   Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  user        User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@unique([workspaceId, userId])
  @@index([userId])
  @@map("workspace_members")
}

model RefreshToken {
  id         String    @id @default(dbgenerated("uuid_generate_v7()")) @db.Uuid
  userId     String    @map("user_id") @db.Uuid
  tokenHash  String    @unique @map("token_hash")
  familyId   String    @map("family_id") @db.Uuid
  expiresAt  DateTime  @map("expires_at") @db.Timestamptz
  revokedAt  DateTime? @map("revoked_at") @db.Timestamptz
  replacedBy String?   @map("replaced_by") @db.Uuid
  userAgent  String?   @map("user_agent")
  ip         String?   @db.Inet
  createdAt  DateTime  @default(now()) @map("created_at") @db.Timestamptz
  user       User @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId]) @@index([familyId]) @@index([expiresAt])
  @@map("refresh_tokens")
}

// ---------- TENANT PLANE (RLS via raw-SQL migration) ----------
model FieldDefinition {  // tenant-plane, RLS-protected
  id          String        @id @default(dbgenerated("uuid_generate_v7()")) @db.Uuid
  workspaceId String        @map("workspace_id") @db.Uuid
  objectType  ObjectType    @map("object_type")
  key         String
  label       String
  dataType    FieldDataType @map("data_type")
  options     Json          @default("[]")
  isRequired  Boolean       @default(false) @map("is_required")
  position    Int           @default(0)
  isActive    Boolean       @default(true) @map("is_active")
  createdAt   DateTime      @default(now()) @map("created_at") @db.Timestamptz
  updatedAt   DateTime      @default(now()) @map("updated_at") @db.Timestamptz
  @@unique([workspaceId, objectType, key])
  @@map("field_definitions")
}

model Company {
  id            String    @id @default(dbgenerated("uuid_generate_v7()")) @db.Uuid
  workspaceId   String    @map("workspace_id") @db.Uuid
  name          String
  domain        String?   @db.Citext
  industry      String?
  employeeCount Int?      @map("employee_count")
  annualRevenue Decimal?  @map("annual_revenue") @db.Decimal(18, 2)
  address       Json      @default("{}")
  ownerId       String?   @map("owner_id") @db.Uuid
  customFields  Json      @default("{}") @map("custom_fields")
  version       Int       @default(0)
  createdAt     DateTime  @default(now()) @map("created_at") @db.Timestamptz
  updatedAt     DateTime  @default(now()) @map("updated_at") @db.Timestamptz
  deletedAt     DateTime? @map("deleted_at") @db.Timestamptz
  workspace     Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  contacts      Contact[]
  deals         Deal[]
  @@index([workspaceId, createdAt, id])
  @@index([workspaceId, name])
  @@index([workspaceId, ownerId])
  @@map("companies")
}

model Contact {
  id           String    @id @default(dbgenerated("uuid_generate_v7()")) @db.Uuid
  workspaceId  String    @map("workspace_id") @db.Uuid
  companyId    String?   @map("company_id") @db.Uuid
  firstName    String?   @map("first_name")
  lastName     String?   @map("last_name")
  email        String?   @db.Citext
  phone        String?
  jobTitle     String?   @map("job_title")
  ownerId      String?   @map("owner_id") @db.Uuid
  customFields Json      @default("{}") @map("custom_fields")
  version      Int       @default(0)
  createdAt    DateTime  @default(now()) @map("created_at") @db.Timestamptz
  updatedAt    DateTime  @default(now()) @map("updated_at") @db.Timestamptz
  deletedAt    DateTime? @map("deleted_at") @db.Timestamptz
  workspace    Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  company      Company?  @relation(fields: [companyId], references: [id], onDelete: SetNull)
  @@index([workspaceId, createdAt, id])
  @@index([workspaceId, lastName, firstName])
  @@index([workspaceId, companyId])
  @@index([workspaceId, ownerId])
  @@map("contacts")
}

model Pipeline {
  id          String    @id @default(dbgenerated("uuid_generate_v7()")) @db.Uuid
  workspaceId String    @map("workspace_id") @db.Uuid
  name        String
  isDefault   Boolean   @default(false) @map("is_default")
  position    Int       @default(0)
  version     Int       @default(0)
  createdAt   DateTime  @default(now()) @map("created_at") @db.Timestamptz
  updatedAt   DateTime  @default(now()) @map("updated_at") @db.Timestamptz
  deletedAt   DateTime? @map("deleted_at") @db.Timestamptz
  workspace   Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  stages      Stage[]
  deals       Deal[]
  @@index([workspaceId, position])
  @@map("pipelines")
}

model Stage {
  id          String    @id @default(dbgenerated("uuid_generate_v7()")) @db.Uuid
  workspaceId String    @map("workspace_id") @db.Uuid
  pipelineId  String    @map("pipeline_id") @db.Uuid
  name        String
  position    Int
  probability Int       @default(0) @db.SmallInt   // 0..100
  color       String?
  stageType   StageType @default(open) @map("stage_type")
  version     Int       @default(0)
  createdAt   DateTime  @default(now()) @map("created_at") @db.Timestamptz
  updatedAt   DateTime  @default(now()) @map("updated_at") @db.Timestamptz
  deletedAt   DateTime? @map("deleted_at") @db.Timestamptz
  pipeline    Pipeline @relation(fields: [pipelineId], references: [id], onDelete: Cascade)
  deals       Deal[]
  @@index([workspaceId, pipelineId])
  @@map("stages")
  // UNIQUE(workspace_id, pipeline_id, position) DEFERRABLE — raw SQL
}

model Deal {
  id                String     @id @default(dbgenerated("uuid_generate_v7()")) @db.Uuid
  workspaceId       String     @map("workspace_id") @db.Uuid
  pipelineId        String     @map("pipeline_id") @db.Uuid
  stageId           String     @map("stage_id") @db.Uuid
  companyId         String?    @map("company_id") @db.Uuid
  primaryContactId  String?    @map("primary_contact_id") @db.Uuid
  title             String
  amount            Decimal?   @db.Decimal(18, 2)
  currency          String     @default("USD") @db.Char(3)
  status            DealStatus @default(open)
  expectedCloseDate DateTime?  @map("expected_close_date") @db.Date
  closedAt          DateTime?  @map("closed_at") @db.Timestamptz
  ownerId           String?    @map("owner_id") @db.Uuid
  customFields      Json       @default("{}") @map("custom_fields")
  version           Int        @default(0)
  createdAt         DateTime   @default(now()) @map("created_at") @db.Timestamptz
  updatedAt         DateTime   @default(now()) @map("updated_at") @db.Timestamptz
  deletedAt         DateTime?  @map("deleted_at") @db.Timestamptz
  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  pipeline  Pipeline  @relation(fields: [pipelineId], references: [id], onDelete: Restrict)
  stage     Stage     @relation(fields: [stageId], references: [id], onDelete: Restrict)
  company   Company?  @relation(fields: [companyId], references: [id], onDelete: SetNull)
  @@index([workspaceId, createdAt, id])
  @@index([workspaceId, pipelineId, stageId])
  @@index([workspaceId, status, expectedCloseDate])
  @@index([workspaceId, ownerId])
  @@index([workspaceId, companyId])
  @@map("deals")
}

model Note {
  id          String         @id @default(dbgenerated("uuid_generate_v7()")) @db.Uuid
  workspaceId String         @map("workspace_id") @db.Uuid
  parentType  NoteParentType @map("parent_type")
  parentId    String         @map("parent_id") @db.Uuid
  body        String
  authorId    String?        @map("author_id") @db.Uuid
  version     Int            @default(0)
  createdAt   DateTime       @default(now()) @map("created_at") @db.Timestamptz
  updatedAt   DateTime       @default(now()) @map("updated_at") @db.Timestamptz
  deletedAt   DateTime?      @map("deleted_at") @db.Timestamptz
  @@index([workspaceId, parentType, parentId, createdAt(sort: Desc)])
  @@index([workspaceId, authorId])
  @@map("notes")
}

model SavedView {
  id             String     @id @default(dbgenerated("uuid_generate_v7()")) @db.Uuid
  workspaceId    String     @map("workspace_id") @db.Uuid
  objectType     ObjectType @map("object_type")
  name           String
  viewKind       ViewKind   @default(table) @map("view_kind")
  filters        Json       @default("[]")
  sort           Json       @default("[]")
  visibleColumns Json       @default("[]") @map("visible_columns")
  isShared       Boolean    @default(false) @map("is_shared")
  ownerId        String     @map("owner_id") @db.Uuid
  position       Int        @default(0)
  createdAt      DateTime   @default(now()) @map("created_at") @db.Timestamptz
  updatedAt      DateTime   @default(now()) @map("updated_at") @db.Timestamptz
  @@index([workspaceId, objectType, ownerId])
  @@map("saved_views")
}

enum WorkspaceRole { owner admin member            @@map("workspace_role") }
enum MemberStatus  { active invited suspended       @@map("member_status") }
enum ObjectType    { company contact deal           @@map("object_type") }
enum StageType     { open won lost                  @@map("stage_type") }
enum DealStatus    { open won lost                  @@map("deal_status") }
enum NoteParentType{ company contact deal           @@map("note_parent_type") }
enum ViewKind      { table kanban                   @@map("view_kind") }
enum FieldDataType { text number boolean date single_select multi_select url email @@map("field_data_type") }
```

> Prisma cannot express RLS, partial/composite/GIN/deferrable indexes, the `set_updated_at()`/`version` and `set_workspace_id()` triggers, the note-integrity trigger, the `uuid_generate_v7()` function, or `NOBYPASSRLS` roles. These are hand-written SQL appended to the relevant `migration.sql` and applied/tracked by `prisma migrate`.

### 4.7 Entity relationships (summary)

- `users` 1—N `workspace_members` N—1 `workspaces` (M:N membership with role + status).
- `workspaces` 1—N every tenant table (`ON DELETE CASCADE` = full tenant teardown).
- `pipelines` 1—N `stages`; `pipelines`/`stages` 1—N `deals` (RESTRICT: move deals before dropping).
- `companies` 1—N `contacts`; `companies`/`contacts` 0..1—N `deals` (SET NULL keeps the deal).
- `notes` polymorphic → `{company|contact|deal}` via `(parent_type, parent_id)`, integrity-checked by trigger.
- `field_definitions` (tenant plane) governs `custom_fields` on `companies`, `contacts`, `deals`.

---

## 5. API Design

CLEVAR exposes two HTTP surfaces from `apps/api`: a single code-first **GraphQL** endpoint at `POST /graphql` for all authenticated product data, and a small set of **REST** endpoints under `/auth/*` for credential exchange and cookie management. `/healthz` and `/readyz` exist for orchestration. There is no other public API in the Foundation.

```
apps/api/src/
  main.ts                      # bootstrap: helmet, cookie-parser, CSP, graphql driver
  graphql/
    graphql.module.ts          # ApolloDriver, autoSchemaFile, plugins
    gql-context.ts             # { req, res, actor, scopedTx, dataloaders }
    complexity.plugin.ts       # query cost estimation + rejection
    error.formatter.ts         # domain errors -> typed GraphQL extensions
    scalars/                   # DateTime, JSON, Cursor, Decimal
  modules/
    workspace/  identity/
    crm/{company,contact,deal,pipeline,stage,note,saved-view,field-definition}/
    common/{pagination,filtering,tenant,errors}/
  auth/
    auth.controller.ts         # REST /auth/* (cookies live here)
  health/health.controller.ts  # /healthz, /readyz (Terminus)
  throttler/throttler.module.ts # Redis-backed rate limiting
```

### 5.1 GraphQL surface

- **Code-first** schema via `@nestjs/graphql` + `@nestjs/apollo` (Apollo Server 4). SDL generated from decorators; `autoSchemaFile: 'schema.gql'` emits a checked-in artifact the frontend codegen consumes. No hand-written `.graphql` type files.
- Introspection and Apollo Sandbox enabled in non-production only.
- Every operation runs through the auth guard, the complexity plugin, and the single RLS transaction (§5.6).

#### 5.1.1 SDL conventions

| Convention | Rule |
|---|---|
| IDs | `ID!` backed by UUID v7 (time-sortable; doubles as the deterministic cursor tiebreaker). |
| Timestamps | `createdAt`/`updatedAt` are `DateTime!`; `deletedAt: DateTime` on soft-deletable objects. |
| Tenancy | `workspaceId` is never a readable or writable field; injected server-side, enforced by RLS. |
| Money | `amount: Decimal` (string-encoded `numeric(18,2)`); per-deal `currency: String!` (ISO 4217). |
| Enums | `UPPER_CASE` on the wire, mapped 1:1 to lower-case DB enums. |
| Concurrency | Mutable objects expose `version: Int!`; update mutations take `expectedVersion: Int!`. |
| Custom fields | Each CRM object exposes `customFields: JSON`; `fieldDefinitions(objectType)` returns metadata. |
| Naming | Mutations verb-first (`createContact`); inputs `<Verb><Type>Input`; filter/order inputs `<Type>Filter` / `<Type>OrderBy` (no `Input` suffix). |
| Pagination | List queries return Relay `*Connection`. No unbounded array fields for collections. |

#### 5.1.2 Core SDL (generated shape)

```graphql
scalar DateTime
scalar JSON
scalar Cursor
scalar Decimal

enum WorkspaceRole { OWNER ADMIN MEMBER }
enum MemberStatus  { ACTIVE INVITED SUSPENDED }
enum DealStatus    { OPEN WON LOST }
enum StageType     { OPEN WON LOST }
enum ObjectType    { COMPANY CONTACT DEAL }          # reused for fields, views, note targets
enum FieldDataType { TEXT NUMBER BOOLEAN DATE SINGLE_SELECT MULTI_SELECT URL EMAIL }
enum ViewKind      { TABLE KANBAN }
enum SortDirection { ASC DESC }

type Workspace {
  id: ID!  name: String!  slug: String!
  createdAt: DateTime!  updatedAt: DateTime!
  members(first: Int, after: Cursor, last: Int, before: Cursor): MemberConnection!
  fieldDefinitions(objectType: ObjectType!): [FieldDefinition!]!
}
type User { id: ID! email: String! fullName: String! avatarUrl: String createdAt: DateTime! }
type Member {
  id: ID! user: User! workspace: Workspace!
  role: WorkspaceRole! status: MemberStatus!
  invitedByUserId: ID createdAt: DateTime!
}
type FieldDefinition {
  id: ID! objectType: ObjectType! key: String! label: String!
  dataType: FieldDataType! options: JSON isRequired: Boolean! position: Int!
}
type Company {
  id: ID! name: String! domain: String ownerId: ID owner: Member
  contacts(first: Int, after: Cursor, filter: ContactFilter): ContactConnection!
  deals(first: Int, after: Cursor, filter: DealFilter): DealConnection!
  customFields: JSON version: Int! createdAt: DateTime! updatedAt: DateTime! deletedAt: DateTime
}
type Contact {
  id: ID! firstName: String lastName: String email: String phone: String jobTitle: String
  company: Company ownerId: ID owner: Member
  customFields: JSON version: Int! createdAt: DateTime! updatedAt: DateTime! deletedAt: DateTime
}
type Pipeline { id: ID! name: String! isDefault: Boolean! stages: [Stage!]! createdAt: DateTime! }
type Stage {
  id: ID! pipeline: Pipeline! name: String! position: Int!
  probability: Int!   # 0..100
  color: String stageType: StageType!
}
type Deal {
  id: ID! title: String! amount: Decimal currency: String! status: DealStatus!
  pipeline: Pipeline! stage: Stage! company: Company primaryContact: Contact
  ownerId: ID owner: Member expectedCloseDate: DateTime closedAt: DateTime
  customFields: JSON version: Int! createdAt: DateTime! updatedAt: DateTime! deletedAt: DateTime
}
type Note {
  id: ID! body: String!            # markdown
  author: Member                   # nullable (author may be removed)
  target: NoteTarget!
  version: Int! createdAt: DateTime! updatedAt: DateTime!
}
union NoteTarget = Company | Contact | Deal
type SavedView {
  id: ID! objectType: ObjectType! name: String! viewKind: ViewKind!
  filters: JSON sort: JSON visibleColumns: [String!]!
  isShared: Boolean! ownerId: ID! position: Int! createdAt: DateTime!
}
```

#### 5.1.3 Queries

```graphql
type Query {
  me: User!
  myWorkspaces: [Member!]!
  workspace: Workspace!

  company(id: ID!): Company
  contact(id: ID!): Contact
  deal(id: ID!): Deal
  pipeline(id: ID!): Pipeline
  note(id: ID!): Note
  savedView(id: ID!): SavedView

  companies(first: Int, after: Cursor, last: Int, before: Cursor,
            filter: CompanyFilter, orderBy: [CompanyOrderBy!], includeDeleted: Boolean): CompanyConnection!
  contacts(first: Int, after: Cursor, last: Int, before: Cursor,
           filter: ContactFilter, orderBy: [ContactOrderBy!], includeDeleted: Boolean): ContactConnection!
  deals(first: Int, after: Cursor, last: Int, before: Cursor,
        filter: DealFilter, orderBy: [DealOrderBy!], includeDeleted: Boolean): DealConnection!
  pipelines: [Pipeline!]!
  notes(targetType: ObjectType!, targetId: ID!, first: Int, after: Cursor): NoteConnection!
  savedViews(objectType: ObjectType!): [SavedView!]!

  # bounded name lookup for ⌘K (ILIKE; not a search-index tier)
  search(term: String!, types: [ObjectType!]): SearchConnection!
}
union SearchResult = Company | Contact | Deal
type SearchEdge { node: SearchResult! cursor: Cursor! }
type SearchConnection { edges: [SearchEdge!]! pageInfo: PageInfo! }
```

#### 5.1.4 Mutations

```graphql
type Mutation {
  createWorkspace(input: CreateWorkspaceInput!): Workspace!
  updateWorkspace(input: UpdateWorkspaceInput!): Workspace!
  inviteMember(input: InviteMemberInput!): Member!            # owner/admin only; role != OWNER
  acceptInvite(input: AcceptInviteInput!): Member!            # already-authenticated user
  updateMemberRole(input: UpdateMemberRoleInput!): Member!    # owner-only for OWNER changes
  removeMember(memberId: ID!): Boolean!

  createCompany(input: CreateCompanyInput!): Company!
  updateCompany(id: ID!, expectedVersion: Int!, input: UpdateCompanyInput!): Company!
  deleteCompany(id: ID!): SoftDeletePayload!
  restoreCompany(id: ID!): Company!

  createContact(input: CreateContactInput!): Contact!
  updateContact(id: ID!, expectedVersion: Int!, input: UpdateContactInput!): Contact!
  deleteContact(id: ID!): SoftDeletePayload!
  restoreContact(id: ID!): Contact!

  createPipeline(input: CreatePipelineInput!): Pipeline!
  updatePipeline(id: ID!, expectedVersion: Int!, input: UpdatePipelineInput!): Pipeline!
  deletePipeline(id: ID!): SoftDeletePayload!
  createStage(input: CreateStageInput!): Stage!
  updateStage(id: ID!, expectedVersion: Int!, input: UpdateStageInput!): Stage!
  reorderStages(pipelineId: ID!, orderedStageIds: [ID!]!): Pipeline!
  deleteStage(id: ID!): SoftDeletePayload!

  createDeal(input: CreateDealInput!): Deal!
  updateDeal(id: ID!, expectedVersion: Int!, input: UpdateDealInput!): Deal!
  moveDealToStage(dealId: ID!, stageId: ID!): Deal!          # validates same pipeline; member allowed
  setDealStatus(dealId: ID!, status: DealStatus!): Deal!
  deleteDeal(id: ID!): SoftDeletePayload!
  restoreDeal(id: ID!): Deal!

  createNote(input: CreateNoteInput!): Note!
  updateNote(id: ID!, expectedVersion: Int!, body: String!): Note!
  deleteNote(id: ID!): SoftDeletePayload!

  createSavedView(input: CreateSavedViewInput!): SavedView!
  updateSavedView(id: ID!, input: UpdateSavedViewInput!): SavedView!
  deleteSavedView(id: ID!): HardDeletePayload!               # saved views are hard-deleted

  createFieldDefinition(input: CreateFieldDefinitionInput!): FieldDefinition!
  updateFieldDefinition(id: ID!, input: UpdateFieldDefinitionInput!): FieldDefinition!
  deleteFieldDefinition(id: ID!): HardDeletePayload!
}

type SoftDeletePayload { id: ID! deletedAt: DateTime! }      # soft-deletable objects
type HardDeletePayload { id: ID! }                            # hard-deleted objects
```

Representative inputs:

```graphql
input CreateWorkspaceInput { name: String!, slug: String }
input InviteMemberInput   { email: String!, role: WorkspaceRole! }   # role != OWNER
input AcceptInviteInput   { token: String! }
input CreateContactInput  { firstName: String, lastName: String, email: String, phone: String,
                            companyId: ID, ownerUserId: ID, customFields: JSON }
input CreateDealInput     { title: String!, amount: Decimal, currency: String,
                            pipelineId: ID!, stageId: ID!, companyId: ID, primaryContactId: ID,
                            expectedCloseDate: DateTime, customFields: JSON }
```

> **Accept-invite split:** `acceptInvite` (mutation) is for an already-authenticated user joining an additional workspace and returns product data. The unauthenticated signup-via-invite path that must set cookies is `POST /auth/accept-invite` (§5.7). Both read role + workspace from the server-side `invitations` row.

### 5.2 Pagination — Relay cursor connections

All collections use Relay connections; offset pagination is prohibited (drifts under concurrent inserts, degrades at depth).

```graphql
type PageInfo { hasNextPage: Boolean! hasPreviousPage: Boolean! startCursor: Cursor endCursor: Cursor }
type ContactEdge { node: Contact! cursor: Cursor! }
type ContactConnection { edges: [ContactEdge!]! pageInfo: PageInfo! totalCount: Int }
```

- **Cursor encoding:** opaque base64url JSON of the sort keys plus the UUIDv7 id tiebreaker. Not an offset, not the raw id. A malformed cursor → typed `INVALID_CURSOR`, never a 500.
- **Keyset translation** (via the Prisma query builder, not raw SQL, so it inherits parameterization + the RLS filter): `after`/`before` map to keyset predicates against the `orderBy` columns with `id` as the deterministic final tiebreaker; the default sort is `(created_at DESC, id DESC)`, index-served by `(workspace_id, created_at, id)`.
- Exactly one direction (`first`/`after` forward or `last`/`before` backward); mixing raises `ARGS_CONFLICT`.
- `first`/`last`: default 25, **max 100**; over-max raises `INVALID_ARGS_FIRST`.
- `totalCount` issues `COUNT(*)` only when selected, so list reads stay cheap.

### 5.3 Filtering & sorting

Filters are **typed input objects** per object (not free-form wire JSON), generated from the same field set as the type, so the API is self-documenting and the complexity plugin can reason about cost. A SavedView's stored `filters`/`sort` JSON is validated against these schemas on write.

```graphql
input StringFilter   { eq: String, neq: String, contains: String, startsWith: String, in: [String!], isNull: Boolean }
input IntFilter      { eq: Int, neq: Int, gt: Int, gte: Int, lt: Int, lte: Int, in: [Int!], isNull: Boolean }
input DecimalFilter  { eq: Decimal, gt: Decimal, gte: Decimal, lt: Decimal, lte: Decimal, isNull: Boolean }
input DateTimeFilter { eq: DateTime, gt: DateTime, gte: DateTime, lt: DateTime, lte: DateTime, isNull: Boolean }
input IdFilter       { eq: ID, in: [ID!], isNull: Boolean }

input ContactFilter {
  and: [ContactFilter!]  or: [ContactFilter!]  not: ContactFilter
  firstName: StringFilter  lastName: StringFilter  email: StringFilter
  companyId: IdFilter  ownerUserId: IdFilter  createdAt: DateTimeFilter
  customField: CustomFieldFilter
}
input CustomFieldFilter { key: String!, string: StringFilter, number: IntFilter, date: DateTimeFilter, boolean: Boolean }
input ContactOrderBy { field: ContactSortField!, direction: SortDirection! = ASC }
enum  ContactSortField { CREATED_AT UPDATED_AT FIRST_NAME LAST_NAME EMAIL }
```

Translation layer (`modules/common/filtering`):

- `and`/`or`/`not` recurse with a **max nesting depth of 4** (`INVALID_QUERY_INPUT` beyond).
- Leaves map to Prisma `where` fragments. `contains`/`startsWith` use `ILIKE` on the `workspace_id`-leading btree (adequate at Foundation scale; no trigram tier per N8).
- **Custom-field filters** require the `key` to exist in `field_definitions` for that `(object_type, workspace_id)` (else `FIELD_NOT_FOUND`); the key is bound as a parameter to `custom_fields ->> $key` (never interpolated; charset `^[a-z][a-z0-9_]*$`), and is cost-weighted by the complexity plugin since it hits the GIN index.
- `orderBy` accepts only enumerated `*SortField` values — no arbitrary column injection.

### 5.4 Error model — typed, non-leaking

```ts
export enum AppErrorCode {
  UNAUTHENTICATED='UNAUTHENTICATED', FORBIDDEN='FORBIDDEN', NOT_FOUND='NOT_FOUND',
  BAD_USER_INPUT='BAD_USER_INPUT', CONFLICT='CONFLICT', INVALID_CURSOR='INVALID_CURSOR',
  ARGS_CONFLICT='ARGS_CONFLICT', RATE_LIMITED='RATE_LIMITED', QUERY_TOO_COMPLEX='QUERY_TOO_COMPLEX',
  FIELD_NOT_FOUND='FIELD_NOT_FOUND', INTERNAL='INTERNAL',
}
```

`formatError` (`graphql/error.formatter.ts`) shapes every error: `{ message, extensions: { code, resource?, requestId, fields? } }`.

| Source error | Mapped code | Client sees |
|---|---|---|
| `AppError(NOT_FOUND)` | `NOT_FOUND` | safe message + resource |
| `class-validator` failure | `BAD_USER_INPUT` | per-field messages in `extensions.fields` |
| Prisma `P2002` (unique) | `CONFLICT` | "That slug is already taken." — no constraint name |
| Optimistic version mismatch | `CONFLICT` | "This record changed since you loaded it." |
| Prisma `P2025` / RLS empty result | `NOT_FOUND` | generic (no cross-tenant existence oracle) |
| Throttler trip | `RATE_LIMITED` | `retryAfterSeconds` in extensions |
| Complexity rejection | `QUERY_TOO_COMPLEX` | `{ cost, max }` |
| Any uncaught throwable | `INTERNAL` | "Something went wrong." + `requestId` only |

Non-leaking rules: in production, `formatError` strips `stacktrace`/`exception`/original message for non-`AppError`; the real error is logged with `requestId`. Cross-tenant probes return `NOT_FOUND` (never `FORBIDDEN`). GraphQL transport is always HTTP `200`; the per-error `code` is the client contract.

### 5.5 Rate limiting & query complexity

**Rate limiting** — `@nestjs/throttler` with a Redis store (shared across replicas):

| Scope | Window | Limit | Notes |
|---|---|---|---|
| Per IP (`/auth/*`) | 1 min | 20 | Brakes credential stuffing; covers signup/accept-invite. |
| Per IP + email on `login` | 15 min | 5 (soft) | After N failures, step-up (CAPTCHA) rather than a flat block, to avoid targeted lockout DoS; counters scoped (email+IP) with a per-email soft cap + alerting. |
| Per authenticated actor (`/graphql`) | 1 min | 600 | Keyed `userId:workspaceId`. |
| Per workspace (mutations) | 1 min | 1200 | Tenant-level ceiling. |
| `acceptInvite` / accept-invite | 15 min | 10 / IP | Throttles invite-token guessing (tokens are hashed/single-use/expiring). |

Limits are starting defaults tuned under load testing.

**Query complexity** — `graphql-query-complexity` as an Apollo validation plugin (before any resolver): per-field base cost 1; connection fields multiply child cost by requested `first`/`last` (capped 100); hard ceiling **1000** cost/operation → `QUERY_TOO_COMPLEX`; **max depth 8** (`graphql-depth-limit`); alias-based field duplication and repeated `node(id:)` lookups are bounded by the same cost ceiling. Relation resolvers use per-request DataLoader (on the scoped tx) to collapse N+1 into batched, RLS-scoped queries. Exact numbers are tunable.

### 5.6 Request execution & tenant isolation hook

Every authenticated GraphQL operation executes inside the single RLS transaction (§2.2/§3.5): the Apollo context builder resolves the actor from the access JWT, the `WorkspaceGuard` validates the `ws` claim against a live membership, the `TenantContextInterceptor` opens one transaction and binds `app.workspace_id` once, and the already-scoped `tx` client is injected into all resolvers/services/DataLoaders. `me`/`myWorkspaces` are the only queries reading across the RLS boundary — a deliberately separate `adminClient` path filtering `workspace_members` by the verified `sub`.

### 5.7 REST auth endpoints (`/auth/*`)

All responses JSON; the refresh token lives only in the httpOnly cookie `clevar_rt` (`HttpOnly; Secure; SameSite=Strict; Path=/auth; Max-Age=30d`; name sourced from `REFRESH_COOKIE_NAME`).

| Method & path | Body in | Returns | Cookie |
|---|---|---|---|
| `POST /auth/signup` | `{ email, password, fullName, workspaceName? }` | `{ accessToken, user }` | sets `clevar_rt` |
| `POST /auth/verify-email` | `{ token }` | `{ ok: true }` | — |
| `POST /auth/login` | `{ email, password }` | `{ accessToken, user, workspaces }` | sets `clevar_rt` |
| `POST /auth/refresh` | *(cookie; optional `{ workspaceId }`)* | `{ accessToken }` | rotates `clevar_rt` |
| `POST /auth/logout` | *(none)* | `{ ok: true }` | clears `clevar_rt`, revokes server-side |
| `POST /auth/request-password-reset` | `{ email }` | `{ ok: true }` (generic) | — |
| `POST /auth/reset-password` | `{ token, password }` | `{ ok: true }` | — |
| `POST /auth/accept-invite` | `{ token, password?, fullName? }` | `{ accessToken, user }` | sets `clevar_rt` |

- **Passwords:** argon2id (~150 ms target). Constant-time compare; generic failure for unknown-email vs wrong-password.
- **Access token:** JWT, 15-min TTL, claims `{ sub, ws, role, jti }`, sent as `Authorization: Bearer`.
- **Refresh token:** opaque 256-bit, hashed SHA-256 server-side, single-use rotation with family-wide revoke on reuse.
- **Workspace switching:** `/auth/refresh { workspaceId }` mints a token scoped to a verified active membership. This is the only switch mechanism (no GraphQL mutation).

**Why auth is REST:** cookie attributes (`HttpOnly/Secure/SameSite/Path/Max-Age`) are an HTTP-transport concern natural in a controller and awkward through Apollo's resolver context; `/auth/refresh` must work without a valid access token, so it can't sit behind the GraphQL auth guard; keeping credential exchange off the introspectable schema shrinks the attack surface and gives it dedicated per-IP throttles and a clean CSRF posture.

### 5.8 Health & readiness

`@nestjs/terminus`, unauthenticated, excluded from throttling and the GraphQL pipeline. Canonical paths everywhere: **`/healthz`** and **`/readyz`**.

| Endpoint | Checks | Semantics |
|---|---|---|
| `GET /healthz` | process up (no deps) | **Liveness** — `200` unless the event loop is dead; failure triggers restart. |
| `GET /readyz` | Postgres `SELECT 1`, Redis `PING`, migration version current | **Readiness** — `200` only when serving; failure removes from rotation without restart. |

Health responses never include version/build hashes or connection strings. `apps/worker` exposes its own `/healthz`/`/readyz` (queue connectivity) so a stuck worker doesn't fail the API's readiness.

---

## 6. Frontend / UI Architecture

The CLEVAR web client is an SPA served as static assets from a CDN, talking to the GraphQL API. It is the only deliverable in `apps/web` for the Foundation.

| Principle | Decision |
|---|---|
| Server state | Apollo Client `InMemoryCache` is the single source of truth for GraphQL data. No duplication into client stores. |
| Ephemeral UI state | Zustand stores hold transient, non-URL, non-server state (sheet open, dnd-in-flight, command palette, sidebar collapsed). |
| View/filter state | The URL query string is authoritative for which records are shown (view id, filters, sort, search, cursor, deals layout). Reload-safe and shareable. |
| Type safety | 100% typed GraphQL via `graphql-codegen` (`client` preset + `typescript-react-apollo`); no hand-written response types. |
| Multi-tenant | The active `workspaceId` is implied by the session, never sent in operation variables. RLS enforces isolation server-side. |
| Design system | Tailwind tokens + shadcn/ui (Radix) primitives, wrapped in `@clevar/ui` (`packages/ui`). |

### 6.1 App shell

A persistent layout (`AppShell`) kept mounted across route transitions.

- **Left nav (`AppSidebar`)** — `Contacts`, `Companies`, `Deals`, `Settings`. Active state via `useMatch`. Collapsed/expanded width persisted in `localStorage` via `useShellStore`. `Settings` fully expanded for `owner`/`admin`; `member` sees profile + personal preferences only.
- **Workspace switcher** — Radix `DropdownMenu` over `myWorkspaces { workspace { id name slug } role }` (fetched once on boot). Selecting a workspace navigates to `/{newSlug}/contacts` and calls `POST /auth/refresh { workspaceId }` (the canonical switch mechanism), which rotates the refresh cookie and returns a new workspace-scoped access token; then `apolloClient.resetStore()` clears any prior-tenant data. The slug is the first path segment of every authenticated route.
- **Top bar (`TopBar`)** — `⌘K` palette (Foundation: a bounded `search(term, types)` `ILIKE` name lookup across contacts/companies/deals, navigating to records), a placeholder notifications bell, and the user menu (profile, theme toggle, sign out → `POST /auth/logout` then `apolloClient.clearStore()` + redirect to `/login`).

Routing uses React Router v6 data routers. The authenticated tree is guarded by `<RequireAuth>` reading the in-memory access token.

```
/login  /signup  /accept-invite?token=…  /verify-email?token=…  /reset-password?token=…
/:workspaceSlug
  ├── /contacts            (?view=&filter=&sort=&q=&cursor=)
  ├── /contacts/:id
  ├── /companies   /companies/:id
  ├── /deals               (kanban default; ?layout=table)
  ├── /deals/:id
  └── /settings/*          (members, field-definitions, pipelines, profile)
```

### 6.2 List views — TanStack Table

All three objects share one headless table engine (`@tanstack/react-table`); we own the markup so it composes with shadcn primitives. Per-object code is limited to column defs and cell renderers.

- `RecordListView` parses the URL (`useUrlViewState()`) into a typed `ListViewState` (view id, filter tree, sort spec, free-text `q`, cursor); filters are encoded as compact base64-JSON.
- State translates into variables for a typed connection query (e.g. `useContactsQuery`); the table uses `manualSorting`/`manualFiltering`/`manualPagination` (all server-side).
- **Sorting:** single-key (asc/desc/none) writing `sort=` to the URL. Multi-sort is out of scope.
- **Filtering:** `RecordFilterPopover` emits the typed filter shape. Custom-field leaves use the typed `customField: { key, string/number/date/boolean }` wire shape (§5.3) — the dotted `custom_fields.<key>` string form is only an internal SavedView storage representation, validated to the typed shape on use.
- **Saved views:** a server `saved_views` record (table per §4.4.7: `filters jsonb`, `sort jsonb`, `visible_columns jsonb`, `view_kind`, `is_shared`, `position`). The picker writes `?view={id}` and hydrates filter/sort/columns. Because the URL carries the concrete filter/sort, a link works even for a recipient who can't see a teammate's private view. (No `is_default` on views — that belongs to pipelines.)
- **Inline create:** a sticky pseudo-row; `Enter` fires `useCreateContactMutation` with an `optimisticResponse` (temp id) and a cache `update` writing the real node into the active connection; on error the optimistic node rolls back with a toast.
- **Column visibility:** driven by the active view's `visible_columns`; admins persist changes to a shared view, members get a personal override in `localStorage`.

### 6.3 Record detail

`/:workspaceSlug/contacts/:id` (and analogues), fetched via a single-record hook; related collections are lazy connection queries per tab.

- **Fields tab** — core fields then custom fields from `fieldDefinitions(objectType)`. Each field is click-to-edit (`InlineEditField`): editing commits an optimistic patch via `update*` passing the loaded `expectedVersion`; a `CONFLICT` surfaces a "record changed, reload" prompt. Custom-field edits validate client-side against the definition before submit.
- **Notes tab** — reverse-chronological `notes(targetType, targetId)` timeline; the composer creates a note with an optimistic entry. Note body is **markdown** (consistent with the SDL).
- **Related tab** — connection queries for associated objects rendered via a compact `RecordTable`; "+ Deal" on a contact opens a pre-filled sheet.

The detail screen is reachable by direct URL and as a right-side `Sheet` peek from a list row; both share the same tab components.

### 6.4 Deals — Kanban with table toggle

`?layout=kanban` (default) or `table`; both read the same filtered/sorted URL state.

- A board renders for the active pipeline (`pipeline { id name stages { id name position color } }`); columns ordered by stage `position`, colored by `stage.color`/`stage_type`.
- The deals connection is fetched once and grouped client-side by `stageId`. Per-column footers show count and a **client-side sum of the loaded page** (a server-side per-stage aggregate is deferred — see Open Questions); large pipelines paginate per column.
- **Drag to move:** `@dnd-kit` (accessible keyboard + pointer); dropping fires `moveDealToStage` with an `optimisticResponse`; dnd-in-flight state lives in `useBoardStore`; on failure the card snaps back with a toast.
- **Table toggle** renders the shared `RecordTable` with deal columns (incl. a `StageBadgeCell`); inline-create, sort, filter, and saved views work identically.

### 6.5 Auth pages

Unauthenticated routes render outside the shell with a centered layout.

| Route | Purpose | Behavior |
|---|---|---|
| `/login` | Sign-in | `useLoginMutation`→ access token in memory (module singleton, never `localStorage`); refresh cookie set server-side. |
| `/signup` | New account + first workspace | Creates user (unverified) + workspace (`owner`) + seeded default pipeline; verification email sent. |
| `/verify-email` | Email verification | Reads `?token=`, POSTs `/auth/verify-email`. |
| `/accept-invite` | Join an existing workspace | Reads `?token=`; same-site POST to `/auth/accept-invite`; role baked into the server-side invitation. |
| `/reset-password` | Set a new password | Reads `?token=`, POSTs `/auth/reset-password`. |

- **Token lifecycle:** the 15-min access token lives in an in-memory variable read by the Apollo `authLink`. An `errorLink` detects GraphQL `UNAUTHENTICATED` via `extensions.code` (the `/graphql` transport is always HTTP 200, so there is no 401 from `/graphql`); only `/auth/*` returns 401. On `UNAUTHENTICATED` it calls a single de-duplicated `refresh()` (httpOnly cookie), retries on success, or redirects to `/login`. A background timer refreshes at ~12 minutes.
- **Form stack:** `react-hook-form` + `zod` mirroring server DTO rules; field-level server errors mapped from `extensions`.

### 6.6 State strategy

| Concern | Where | Why |
|---|---|---|
| Records, views, pipelines, current user/workspace, notes | Apollo `InMemoryCache` (normalised by `id`) | One server-truth; mutations propagate via normalisation. |
| Which records are shown (view, filters, sort, search, cursor, layout) | URL search params | Shareable, reload-safe, deep-linkable. |
| Sheet/dnd/command/sidebar/per-user column overrides | Zustand | Ephemeral; not in URL or cache. |
| Auth access token | In-memory module singleton | Never persisted. |

Apollo cache `typePolicies` define cursor-connection `merge`/`read` for every paginated field, keyed by `filter`/`orderBy` (and `pipelineId` for deals).

### 6.7 GraphQL codegen & folder structure

The server publishes SDL from its code-first schema. `apps/web` runs `graphql-codegen` (`apps/web/codegen.ts`, `client` preset + `typescript-react-apollo`) against the live schema (dev) or committed `schema.graphql` (CI), scanning `**/*.graphql.ts`. Output to `apps/web/src/gql/` (gitignored). `pnpm gql:generate` is a `turbo` dependency of `web#build`/`web#dev`, so types never drift. The `Cursor` scalar maps to `string` and `Decimal` to `string` in codegen `scalars` (alongside `DateTime`/`JSON`); operations declare cursor variables as `$after: Cursor` and select real fields (e.g. `firstName lastName email`, not a non-existent `name`/`primaryEmail`).

```
apps/web/src/
  main.tsx  routes.tsx
  app/{AppShell,RequireAuth,WorkspaceSwitcher,TopBar}.tsx
  lib/{apollo,auth,url}/
  stores/{useShellStore,useBoardStore,useCommandStore}.ts
  gql/                       # GENERATED (gitignored)
  features/{auth,records,contacts,companies,deals,notes,views,settings,search}/
  components/                # EmptyState, ErrorState, DataLoader
```

### 6.8 Design system & UX states

shadcn/ui primitives generated into `packages/ui` (`@clevar/ui`); Tailwind configured against CSS custom properties for theming (`.dark` toggle persisted in `useShellStore`). Feature components compose `@clevar/ui` (never Radix directly); `cn()` + `class-variance-authority` drive variants (e.g. badge per stage color). TanStack Table renders through shadcn `Table` primitives.

Loading/empty/error UX: skeletons matching the final layout; inline "load more" spinner; distinct `EmptyState` for no-records vs filtered-to-nothing; `ErrorState` with retry (network vs permission copy); mutation errors as toasts mapped from `extensions.code`; stale-while-revalidate background refetch. Optimistic updates (inline create/edit, note create, deal drag) supply an `optimisticResponse` + cache `update`; on error Apollo discards the optimistic layer and a toast appears. Normalised-by-`id` cache means one edit propagates to list, detail header, peek sheet, and related tables.

---

## 7. Repo, Tooling, Infra & Testing

Guiding principle: **minimal-but-scalable** — one unified TypeScript monorepo with three deployable apps and a small shared-package set, a thin build/test toolchain, and an infra surface one engineer can run end-to-end on a laptop, structured so horizontal scale is a deployment change, not a refactor.

### 7.1 Monorepo layout

One pnpm + Turborepo workspace. Deployables under `apps/`, reusable code under `packages/`. No app imports another app.

```
clevar/
├── apps/
│   ├── api/            # NestJS GraphQL API (HTTP) — Apollo Server, code-first
│   ├── web/            # React + Vite SPA — Apollo Client + GraphQL codegen
│   └── worker/         # NestJS application context — BullMQ processors (no HTTP)
├── packages/
│   ├── db/             # Prisma schema, migrations, generated client, seed, RLS SQL
│   ├── shared/         # framework-agnostic TS: enums, zod schemas, error codes, tenant helpers
│   ├── ui/             # React component library: shadcn/ui primitives + Tailwind preset
│   └── config/         # eslint/tsconfig/tailwind presets, typed env loading
├── docker/compose.dev.yml
├── .github/workflows/ci.yml
├── turbo.json   pnpm-workspace.yaml   package.json   tsconfig.base.json   .env.example
```

| Workspace | Package | Type | Key contents |
|---|---|---|---|
| `apps/api` | `@clevar/api` | NestJS HTTP | GraphQL resolvers, services, guards, `TenantContextInterceptor`, auth |
| `apps/worker` | `@clevar/worker` | NestJS context | BullMQ processors (emails, soft-delete purge), reuses API domain modules |
| `apps/web` | `@clevar/web` | Vite SPA | Routes, Apollo Client, generated hooks, TanStack Table views |
| `packages/db` | `@clevar/db` | Library | `schema.prisma`, `migrations/`, RLS SQL, `PrismaService`, `seed.ts`, `newId()` |
| `packages/shared` | `@clevar/shared` | Library | enums, zod schemas, error codes, `withTenant`/`TenantContext`, branded IDs |
| `packages/ui` | `@clevar/ui` | Library | shadcn primitives, `tailwind-preset.ts` |
| `packages/config` | `@clevar/config` | Library | typed env loading, presets |

`apps/api` and `apps/worker` are separate deployables sharing NestJS modules and the `@clevar/db` client; `api` runs an HTTP listener (sized for request concurrency), `worker` runs `createApplicationContext()` (sized for queue depth), so a slow job never starves the GraphQL event loop.

**Dependency direction (acyclic, lint-enforced via `no-restricted-imports` + Turbo graph):**

```
apps/web    ─▶ packages/ui ─▶ packages/shared
apps/api    ─▶ packages/db, packages/shared, packages/config
apps/worker ─▶ packages/db, packages/shared, packages/config
```

`packages/shared` depends only on `zod`. The Prisma client is emitted into `packages/db` and re-exported, so every app imports one typed client from `@clevar/db`.

### 7.2 pnpm workspaces

```yaml
# pnpm-workspace.yaml
packages: ["apps/*", "packages/*"]
```

- `"packageManager": "pnpm@9.x"`; `engines` pins `node >=20.11 <23`; CI runs `pnpm install --frozen-lockfile`.
- Internal deps use `workspace:*`. Strict `node_modules` (no hoisting) catches phantom dependencies at dev time.

### 7.3 turbo.json pipeline

```jsonc
{
  "$schema": "https://turbo.build/schema.json",
  "globalEnv": ["NODE_ENV"],
  "globalDependencies": ["tsconfig.base.json", ".env"],
  "tasks": {
    "db:generate": { "cache": true, "inputs": ["prisma/schema.prisma"], "outputs": ["generated/**"] },
    "build":     { "dependsOn": ["^build", "db:generate"], "outputs": ["dist/**", ".vite/**"] },
    "typecheck": { "dependsOn": ["^build", "db:generate"], "outputs": [] },
    "lint":      { "outputs": [] },
    "test:unit": { "dependsOn": ["db:generate"], "outputs": ["coverage/**"] },
    "test:integration": { "dependsOn": ["db:generate"], "cache": false },
    "test:e2e":  { "cache": false },
    "dev":       { "cache": false, "persistent": true }
  }
}
```

`^build` builds internal deps first; `db:generate` is a global prerequisite; DB-touching tasks are uncached (external state). Remote caching is optional.

### 7.4 Local dev — docker-compose

Only stateful infra runs in Docker; Node apps run on the host for HMR/debugging.

```yaml
# docker/compose.dev.yml
services:
  postgres:
    image: postgres:16
    command: ["postgres", "-c", "max_connections=200"]
    environment: { POSTGRES_USER: clevar, POSTGRES_PASSWORD: clevar, POSTGRES_DB: clevar_dev }
    ports: ["5432:5432"]
    volumes: ["clevar_pg:/var/lib/postgresql/data"]
    healthcheck: { test: ["CMD-SHELL", "pg_isready -U clevar -d clevar_dev"], interval: 5s, retries: 10 }
  redis:
    image: redis:7
    command: ["redis-server", "--save", "", "--appendonly", "no"]
    ports: ["6379:6379"]
    healthcheck: { test: ["CMD", "redis-cli", "ping"], interval: 5s, retries: 10 }
volumes: { clevar_pg: }
```

First-run:

```bash
pnpm install
cp .env.example .env
docker compose -f docker/compose.dev.yml up -d
pnpm --filter @clevar/db migrate:dev    # apply migrations + RLS SQL (creates clevar_app + clevar_migrator)
pnpm --filter @clevar/db seed           # demo workspace + users + default pipeline
pnpm dev                                # turbo: api + worker + web in parallel
```

> Migrations run as `clevar_migrator` (owner); the apps connect via `DATABASE_URL` as the non-superuser `clevar_app` (no `BYPASSRLS`), so even a local dev cannot bypass RLS (§7.10).

### 7.5 Canonical environment variables

One committed `.env.example`. Variables are validated at boot by a `zod` schema; the process refuses to start on a missing/malformed required var.

| Category | Variable | Notes |
|---|---|---|
| Core | `NODE_ENV` | `development`/`test`/`production` |
| | `APP_BASE_URL` | cookie domain + CORS base |
| | `PORT` | `4000` (api HTTP) |
| Database | `DATABASE_URL` | `clevar_app` role (no `BYPASSRLS`), via PgBouncer (transaction mode) |
| | `DATABASE_MIGRATION_URL` | `clevar_migrator` owner role; `directUrl`; CI/CD only, never in runtime pods |
| | `DATABASE_POOL_MAX` | `10` per replica (see connection budget §3.7) |
| Redis/Queue | `REDIS_URL` | BullMQ + rate limiting |
| | `QUEUE_PREFIX` | `clevar` |
| | `WORKER_CONCURRENCY` | `5` |
| Auth | `JWT_ACCESS_SECRET` / `JWT_ACCESS_TTL` | HS256; `15m` |
| | `JWT_REFRESH_SECRET` / `JWT_REFRESH_TTL` | distinct secret; `30d` |
| | `REFRESH_COOKIE_NAME` | `clevar_rt` — httpOnly, Secure, **SameSite=Strict**, Path=/auth |
| | `ARGON2_MEMORY_KIB` / `ARGON2_TIME_COST` / `ARGON2_PARALLELISM` | `19456` / `2` / `1` (~150 ms) |
| Email | `EMAIL_PROVIDER_API_KEY` / `EMAIL_FROM` | transactional email transport (verify/reset/invite) |
| Observability | `LOG_LEVEL` | `info`/`debug`/`warn`/`error` |
| | `OTEL_EXPORTER_OTLP_ENDPOINT` / `OTEL_SERVICE_NAME` | optional; no-op when unset |
| | `SENTRY_DSN` | optional; empty disables |
| Security | `CORS_ALLOWED_ORIGINS` | SPA origin allowlist (credentials included) |
| | `TRUST_PROXY` | `true` behind a LB |

```ts
// packages/config/src/env.ts (sketch)
import { z } from "zod";
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development","test","production"]),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  EMAIL_PROVIDER_API_KEY: z.string().min(1),
  PORT: z.coerce.number().default(4000),
  LOG_LEVEL: z.enum(["debug","info","warn","error"]).default("info"),
});
export const env = EnvSchema.parse(process.env); // throws → exit non-zero
```

A minimal email transport (provider API or SMTP) sends verify/reset/invite messages; templates live in `packages/shared`. The worker dequeues `email.send` jobs (payload: template + recipient + workspace-scoped data).

### 7.6 CI outline (`.github/workflows/ci.yml`)

Postgres + Redis run as GitHub Actions service containers so integration/RLS tests hit a real Postgres 16.

```
trigger: pull_request, push→main
job: setup     → checkout, node 20, pnpm install --frozen-lockfile (cached)
job: quality   (needs setup) → turbo run lint typecheck   (incl. import-boundary rules)
job: test      (needs setup; services postgres:16, redis:7)
  • pnpm --filter @clevar/db migrate:deploy
  • turbo run test:unit            (Vitest, no I/O)
  • turbo run test:integration     (real PG: resolvers, RLS policy tests)
  • upload coverage (advisory threshold)
job: e2e       (needs setup; services pg/redis) → boot api+worker, Playwright/supertest flows
job: build     (needs quality, test) → turbo run build (dist for api/worker/web)
job: migrate-check (needs setup)
  • prisma migrate diff --exit-code      (schema.prisma == committed migrations)
  • prisma migrate deploy on throwaway db
job: secrets   → gitleaks scan of the diff
```

Gates: `prisma migrate diff --exit-code` fails on schema/migration drift; lint enforces the dependency direction; coverage is advisory in Foundation (hard gate deferred until the API surface stabilizes).

### 7.7 Observability

| Concern | Choice | Detail |
|---|---|---|
| Structured logging | `pino` (`nestjs-pino`) | JSON to stdout; request-scoped child logger binds `requestId`/`workspaceId`/`userId`. Redaction drops `password`, `authorization`, `cookie`, `*.token`; **record field values are never logged** (§3.10). `pino-pretty` in dev only. |
| Correlation | `requestId` | Generated/propagated (`x-request-id`), stored in `AsyncLocalStorage` with tenant context, stamped on logs and enqueued job payloads. |
| Health | `@nestjs/terminus` | `/healthz` (liveness), `/readyz` (PG `SELECT 1` + Redis `PING`). Worker exposes the same. |
| Tracing seam | OpenTelemetry | `instrument.ts` imported before the Nest app in api + worker; auto-instruments HTTP/GraphQL/Prisma/ioredis. **No-op when `OTEL_EXPORTER_OTLP_ENDPOINT` is unset.** A seam, not a full rollout. |
| Error tracking | Sentry | Initialized only when `SENTRY_DSN` is set; a global exception filter tags `requestId`/`workspaceId` (never PII). |
| Metrics | deferred | No Prometheus endpoint in Foundation; called out explicitly so it isn't mistaken for an omission. |

```ts
// apps/api/src/main.ts
import "./instrument";                 // MUST be first: OTel + Sentry patch the runtime
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
```

### 7.8 Testing strategy

Three layers; the integration layer proves tenant isolation and carries the most weight.

| Layer | Runner | Scope |
|---|---|---|
| Unit | Vitest | Pure functions, services with mocked Prisma/Redis, zod schemas, permission logic, custom-field validation. No I/O. |
| Integration | Vitest + Testcontainers (CI service Postgres) | Real Postgres 16: repositories, resolvers via in-process Nest test app, and **RLS policy tests**. Per-test transaction rollback or truncate. |
| E2E | Playwright (web) + supertest (GraphQL) | Full stack: sign-up → verify → create workspace → invite → CRUD contact/company/deal → move deal across stages → save a view. |

**RLS policy tests are first-class** — they connect as the non-superuser `clevar_app` (the same role prod uses):

```ts
// apps/api/test/integration/rls/contact-isolation.spec.ts (shape)
it("hides rows from other workspaces", async () => {
  await asWorkspace(WS_A, async (tx) => {
    const rows = await tx.$queryRaw`SELECT id FROM contacts`;
    expect(rows).toHaveLength(1);            // only WS_A's contact
  });
});
it("fails closed when app.workspace_id is unset", async () => {
  await expect(rawAppClient.$queryRaw`SELECT * FROM contacts`).resolves.toHaveLength(0);
});
```

`asWorkspace(id, fn)` uses the canonical parameterized binding (matching the runtime, never string-interpolated `SET LOCAL`):

```ts
await prisma.$transaction(async (tx) => {
  await tx.$executeRaw`SELECT set_config('app.workspace_id', ${id}, true)`;
  return fn(tx);
});
```

A CI guard test enumerates every tenant-scoped table from `schema.prisma` and asserts each (minus the reviewed global-table allowlist, §3.12 T11) has RLS enabled + forced + a policy, so a new table without a policy fails the build.

### 7.9 Migration & seeding

| Command (`pnpm --filter @clevar/db ...`) | Purpose |
|---|---|
| `migrate:dev` | Author migrations: diff `schema.prisma`, write `migrations/<ts>_<name>/migration.sql`, apply, regenerate client. **RLS/trigger/index SQL is appended to the migration** so policy changes are versioned with table changes. |
| `migrate:deploy` | Apply committed migrations forward-only in CI/prod (using `DATABASE_MIGRATION_URL`). |
| `migrate:status` | Applied vs pending (pre-deploy gate). |
| `seed` | Idempotent `seed.ts`: demo workspace, one owner + one member (argon2id), default `Sales` pipeline + stages, sample contacts/companies/deals. Never runs against production. |

Rules: migrations are forward-only and immutable once merged; new tenant-scoped tables must ship with `workspace_id NOT NULL` + `ENABLE/FORCE RLS` + an isolation policy + the `set_workspace_id`/`set_updated_at` triggers + a `(workspace_id, ...)` btree index (the §7.8 guard enforces the policy half; review enforces the index). Prod deploy uses expand → migrate → contract (backward-compatible) for zero-downtime rolling deploys.

### 7.10 Secrets handling

| Principle | Implementation |
|---|---|
| Never committed | `.env` is git-ignored; only `.env.example` is committed; `gitleaks` scans diffs in CI. |
| Validated at boot | The §7.5 zod schema rejects short/missing JWT/email secrets; misconfig crash-loops loudly. |
| Two DB roles | `clevar_app` (runtime, no `BYPASSRLS`) vs `clevar_migrator` (`DATABASE_MIGRATION_URL`, DDL only) — the backbone of isolation: a compromised app process cannot read across tenants. |
| Injected, not baked | Secrets come from the orchestrator's secret store as env at runtime; excluded from Turbo task `env` lists so they never enter the cache key or logs. |
| Rotation-ready | Independent access/refresh secrets read at boot; rotation is a rolling restart. Refresh tokens are hashed server-side, so a refresh-secret rotation can be paired with revocation. |
| Pooler hardening | PgBouncer holds the `clevar_app` credential via a secret-managed `auth_query`; its `connect_query` is reviewed to ensure it cannot set the `app.*` GUC namespace. |
| Clean logs | pino redaction (§7.7) keeps secrets/cookies/tokens out of stdout. |

### 7.11 How this scales (Foundation → production)

- **API:** `apps/api` is stateless (tenant context in `AsyncLocalStorage` per request); add replicas behind a LB. DB connections bounded per replica (`DATABASE_POOL_MAX`), fronted by PgBouncer (transaction mode) — compatible with `SET LOCAL` because the GUC is transaction-scoped (connection budget §3.7).
- **Workers:** `apps/worker` scales by replica count and `WORKER_CONCURRENCY`; BullMQ distributes jobs; background work never touches the API event loop.
- **DB:** single Postgres 16 primary for Foundation; read replicas and partition-by-`workspace_id` are unblocked later precisely because `workspace_id` leads every tenant index.
- **Build/CI:** Turbo content-hash caching keeps CI time flat as the monorepo grows.

---

## 8. Open Questions (consolidated)

**Scope & product**
1. Confirm the supported custom-field types for v1 (this spec adopts `text, number, boolean, date, single_select, multi_select, url, email`; `datetime`/`currency` are deferred — is that acceptable?).
2. Is CSV import of contacts/companies a thin Foundation follow-on or fully deferred? (Influences the async worker set and dedup requirements.)
3. What is the reference dataset size and SLA environment for the NF1 latency gate (rows per object, concurrent workspaces) so acceptance is measurable?
4. Is region/data-residency a near-term requirement that should influence the tenancy seam now (workspace→region mapping), or is single-region acceptable for the Foundation?
5. Should companies support a self-referential `parent_company_id` (subsidiary hierarchies), or is that deferred? (Currently omitted.)
6. Do we need many-to-many contact↔deal participation with roles, or is `primary_contact_id` sufficient for v1? (A `deal_contacts` join table is the extension point.)

**Auth & membership**
7. Confirm the accepted ≤15-minute window during which a removed member or demoted admin still operates with a stale token, versus adding a membership-version short-circuit on the hot path.
8. Is a service/API-key auth path (programmatic access) in scope? If so it needs its own tenant-binding (key → workspace_id) parallel to the JWT path. (Currently out of scope.)
9. Confirm `SameSite=Strict` + single-registrable-domain topology is acceptable; if SPA and API must live on unrelated sites, switch to `SameSite=None; Secure` + double-submit CSRF.

**Data & API**
10. Should `totalCount` be exact (`COUNT(*)`) or estimated for very large tenants? (Exact gets expensive past a few hundred thousand rows.)
11. For Kanban column-footer rollups, is a client-side page sum acceptable, or do we add a server-side per-stage aggregate resolver in Foundation? (Currently client-side.)
12. Is an idempotency-key header on `create*` mutations needed for safe client retries, or is at-least-once with client-side dedupe acceptable?
13. Do rate-limit tiers need to become per-plan later, and should the limit config be sourced from the workspace record now to avoid a billing-era migration?
14. Should soft-deleted rows remain visible to owner/admin via `includeDeleted` only, and what is the hard-purge window (e.g. 30 days)? Confirm the `refresh_tokens` retention window for the sweep job.
15. Is multi-key sorting needed at launch, or is single-column sort sufficient? (Currently single.)

**Infra & tooling**
16. Confirm Vitest vs Jest (this spec assumes Vitest for Vite alignment; Jest is an equivalent substitute).
17. Confirm Testcontainers (local) + GitHub Actions service containers (CI) for the real-Postgres RLS tests.
18. Where should production secrets live (Kubernetes Secrets vs cloud secret manager vs Vault)? The doc is provider-agnostic.
19. Should CI enforce a hard coverage threshold now, or keep it advisory until the API surface stabilizes? (Currently advisory.)
20. PgBouncer placement: cluster service vs per-pod sidecar? (Sidecar simplifies `SET LOCAL` reasoning; service centralizes connection limits.)
21. Confirm cloud provider/managed-service vendors so backup/PITR/failover SLAs and IAM auth options can be made concrete.

## 9. Assumptions

- **Auth completeness:** email verification and password reset (token-based) are treated as in-scope because a production email/password foundation requires them and they share the BullMQ email tier; AC1 depends on verification. If deferred, AC1/the verify+reset rows/endpoints should be trimmed.
- **Soft-delete + restore** is assumed for CRM business objects (justifying `deleted_at`, the purge worker, and `restore*` mutations); saved views, memberships, and refresh tokens are hard-deleted/revoked.
- **Saved views** support both `table` and `kanban` kinds and a personal-vs-shared scope flag; if kanban should be deferred with later kanban/automation work, it moves out of scope.
- **Invite-by-email** is the only way to add members beyond the workspace creator; SSO/SCIM provisioning is explicitly deferred.
- **Custom-field data types** are the eight listed in §4.5; richer types (relation-as-field, formula, rollup, datetime, currency) and custom-field uniqueness are deferred.
- **Deployment** targets a Kubernetes-style managed container platform (concrete-but-swappable); the locked stack named containers + managed Postgres/Redis + LB but not a specific orchestrator/cloud.
- **PgBouncer transaction-pooling mode** is the chosen pooler — the only mode fully compatible with the `SET LOCAL`/`set_config(...,true)` RLS pattern.
- **Read replicas and `workspace_id` partitioning** are the forward scaling path, NOT a Foundation deliverable; a single primary meets NF1/NF2.
- **Apollo Server** (per the locked decision) is used throughout.
- **Two logical Redis instances** (queue vs cache) are assumed for durability isolation but can collapse to one if preferred.
- **Single active workspace per access token**; switching workspaces re-mints a token via `/auth/refresh { workspaceId }`; the `WorkspaceGuard` validates the `ws` claim against active membership on every request.
- **Argon2id parameters** (`memoryCost 19456 KiB, timeCost 2, parallelism 1`, ~150 ms) are an OWASP-aligned starting point calibrated to production hardware.
- **HS256** access-token signing starts the design; RS256 is a later option if signing/verification split across services.
- **`adminClient`** (un-RLS'd) is permitted only for the enumerated global tables and is restricted by a compile-time repository allowlist to the auth/identity modules.
- **Money:** `numeric(18,2)` + per-deal `currency char(3)`, exposed as a `Decimal` scalar; not floats, not integer-minor-units.
- **UUID v7** PKs are generated by a database `uuid_generate_v7()` default (and optionally an app `newId()`), so id doubles as the deterministic, time-sortable cursor tiebreaker.
- **`citext` and `pgcrypto`** extensions are available/installable in the target Postgres 16 environment.
- **Notes** have no `custom_fields` (custom fields are scoped to company/contact/deal per `object_type`).
- **Routing/forms/dnd libraries:** React Router v6 (data routers), `react-hook-form` + `zod`, `@dnd-kit` — not named in the locked stack but consistent with it.
- **Pagination** is Relay-style cursor connections (edges/pageInfo/totalCount); the SPA holds the 15-minute access token in memory and silently calls `/auth/refresh`.
- **Vitest** for unit/integration, **Playwright** for e2e; **Testcontainers** locally + GitHub Actions service containers in CI; **pnpm 9 + Turborepo** (not Nx); **GitHub Actions** CI.
- **RLS SQL** is versioned alongside Prisma migrations (appended to `migration.sql`), since Prisma cannot express policies.
- **OpenTelemetry/Sentry** are optional seams (no-op when endpoints/DSN unset); a Prometheus/metrics endpoint is intentionally deferred.
- **The reference open-source applications** in the workspace were read only to validate that the chosen patterns are realistic; no code, naming, or origin from them appears anywhere in this document.

## 10. Roadmap (Later Specs)

These layers are named **solely to fix the architectural seams**; they are designed in their own specifications and are explicitly **not** part of the Foundation. Each consumes the Foundation through the same authenticated, RLS-isolated GraphQL surface and the same `workspace_id` tenancy contract.

| Seq | Later spec | What it adds (one line) | Foundation seam it relies on |
| --- | --- | --- | --- |
| 2 | **Channels / Inbox** | Multi-channel conversations linked to CRM contacts/companies via a *messaging engine*. | Contacts/companies as participants; workspace isolation; membership/roles; new RLS tables + new BullMQ queues. |
| 3 | **Workflow Builder** | Trigger/condition/action automation over CRM objects and channel events. | Object change events (introduced via a later transactional outbox + relay reader role on the same `workspace_id`+RLS pattern); field metadata; the BullMQ async tier; the `version`-based optimistic-concurrency protocol for programmatic writers. |
| 4 | **AI Agents + Credits** | LLM-backed assistants over CRM + conversation context, metered by a credit ledger. | Saved views/objects as context; workspace-scoped credit accounting (tightening the §1.6 ceilings); async jobs; the same optimistic-concurrency protocol. |

The Foundation introduces **no** schema, code, or config for these layers. Where a neutral term is needed in later work, the CRM data layer is the *"CRM engine"* and the conversation layer is the *"messaging engine."* The Foundation leaves clean extension points — the metadata-driven field system, the async queue, the `version` conflict-resolution protocol, the per-tenant ceilings, and a uniform GraphQL contract — so these layers attach without reworking the core.