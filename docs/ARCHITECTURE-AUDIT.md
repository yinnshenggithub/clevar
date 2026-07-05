# Clevar Architecture Audit — 2026-07-05

Full-codebase audit (~19k lines). No code changed. Findings ranked; remediation phased.

## 1. Architecture map

**Stack**: Next.js 15 App Router + Prisma/Postgres (Neon), server-component-first, Server Actions for mutations, Vercel serverless + single daily cron. No test suite.

**Request path**:

```
Browser ──► Server Component page (force-dynamic, direct Prisma reads)
        ──► Server Action mutation:
              requireAuth() → JWT cookie → fresh WorkspaceMember lookup
              → zod parse (sometimes)
              → withTenant(tx) — sets app.workspace_id GUC, Postgres RLS enforces isolation
              → after(() => runWorkflows + dispatchWebhooks)   [fire-and-forget]
              → revalidatePath / redirect
```

**Inbound message path**:

```
Meta/WhatsApp/TikTok webhook ──► signature check (only if env secret set)
  ──► persistInbound (find-or-create contact + conversation, insert message)
  ──► 200 OK
  ──► after(): runWorkflows("message_received") → agent rules → runAgentReply
        (blocking generateText, maxSteps:5 tool loop, live CRM tools) → send via Graph API
```

**Workflow engine**: canvas step-tree → `compile()` flattens to bytecode-style `Instr[]` with integer PC → interpreter loop. `wait` persists `WorkflowRun {pc, context JSON, resumeAt}`; daily cron (`vercel.json`, `0 5 * * *`) resumes due runs + scheduled triggers by iterating all workspaces serially.

**Strengths**:
- RLS design excellent: `FORCE ROW LEVEL SECURITY` + insert trigger + fail-closed GUC (`prisma/migrations/1_rls`). All 30 tenant tables covered. Forgotten filter returns zero rows, not a leak.
- Role re-derived from DB per request, never trusted from JWT. API keys/invite tokens SHA-256 hashed, bcrypt cost 12.
- Workflow compile-to-PC design — stable resume point across suspends.
- Server-component-first with `after()` for post-response work is the right Vercel pattern.
- Composite `workspaceId`-leading indexes on most hot paths.

## 2. Findings (ranked)

### P0 — Security

1. **TikTok webhook unauthenticated + cross-tenant lead injection.** `src/app/api/tiktok/webhook/route.ts:17-37` has no signature verification; line 30 falls back to *the first enabled TikTok connection in any workspace* when advertiser resolution fails. Anyone can POST fake leads into an arbitrary tenant's CRM.
2. **WhatsApp/Meta signature checks fail open.** `whatsapp/webhook/route.ts:34-37` and `meta/webhook/route.ts:42-45` skip HMAC verification entirely when the corresponding env secret is unset.
3. **Channel access token exfiltratable via workflow templates.** Template `lookup()` walks arbitrary dotted paths over the whole scope (`src/lib/workflow/template.ts:5-14`); `buildScope` puts raw context — including `channel.accessToken` — under `trigger` (`engine.ts:131`). `{{trigger.channel.accessToken}}` in any message/webhook step leaks the live WhatsApp token. No namespace allowlist.
4. **SSRF in knowledge URL import.** `src/lib/url-extract.ts:4-23` blocks private IPs by string match only — no DNS resolution — and follows redirects, so a public URL 302-ing to `http://169.254.169.254/` reaches cloud metadata.
5. **Invite acceptance never checks invitee email** (`src/lib/actions/members.ts:58-83`) — any authenticated user with the link joins with the invitation's role. Also login timing oracle for user enumeration (`actions/auth.ts:114-117` — bcrypt only runs when user exists).
6. **Provider access tokens and webhook secrets stored plaintext in DB** (`schema.prisma:416,468,486`). No encryption layer.
7. **Prompt injection → live tool execution.** Knowledge chunks and inbound messages flow verbatim into the system prompt; agent tools (`src/lib/agent-actions.ts:67,115,131-147`) can reassign conversations, apply labels, overwrite contact email/phone via substring matching, gated only by soft prompt guards.

### P1 — Correctness

8. **Daily cron breaks the workflow engine's own features.** Engine supports minute-granularity waits (`engine.ts:15`); cron fires once/day (`vercel.json`). "Wait 5 minutes" resumes up to 24h late; `task_reminder` can miss its window entirely.
9. **Post-Wait sends silently no-op.** `channel` stripped from persisted run context, never re-resolved on resume (`workflow/index.ts:214`); `send_whatsapp` after a Wait early-returns (`workflow/actions.ts:265`). Wait-then-message drips broken.
10. **No idempotency on inbound.** `Message.waMessageId` not unique, no processed-id check (`whatsapp/webhook/route.ts:130-142`). Provider retries → duplicate messages, duplicate AI replies, duplicate credit debits. No `leadgen_id` dedupe either.
11. **Find-or-create races.** No unique constraints on `(workspaceId, phone/email)` contacts, `(workspaceId, channelType, customerPhone)` conversations, `(workspaceId, domain)` companies → concurrent webhooks create duplicates. Scheduled-trigger dedupe writes markers into tenant-visible `customFields` (`workflow/index.ts:168-201`) — non-atomic and pollutes user data.
12. **Workflow runs fragile.** Action failures swallowed, run reports DONE (`engine.ts:202-204`); crashed `RUNNING` runs orphaned forever (no lease); FAILED runs never retried despite `attempts` field; resume recompiles from *current* workflow definition — editing a workflow mid-Wait makes saved PC point into a different program (`workflow/index.ts:221`).
13. **Credit gate non-atomic and post-hoc** (`src/lib/credits.ts`): balance check and debit are separate transactions; debit after generation → concurrent bursts overspend unboundedly; streaming disconnects skip `onFinish` debit.

### P1 — Scalability

14. **Cron serial full scan** of all workspaces × workflows × records per tick (`workflow/index.ts:136,245`), one tx per workspace, 200-record cap silently drops backlog. AI reply pipeline lives in `after()` on 60s-capped invocation, no queue — slow LLM turn = reply silently lost.
15. **Hot-path missing index**: WhatsApp webhook contact-by-phone lookup, no `(workspaceId, phone)` index (`webhook/route.ts:111`). Import loads entire contact table into memory for dedupe (`actions/import.ts:77-83`).
16. **N+1 in custom objects**: `getLinkedRecords` fetches 500 rows per object definition, filters in JS (`object-data.ts:119-148`); `relationOptions` per relation field (`:43-104`); `globalSearch` substring-scans JSON in JS, misses past newest 50 (`actions/search.ts:68-85`). Deals board fetches entire pipeline, no `take` (`deals/page.tsx:31-35`).
17. **Inbox zero realtime** — no polling/SSE for agents; customer widget polls every 4s. Backwards.

### P2 — Maintainability / duplication

18. **No channel abstraction.** Find-or-create-conversation implemented 3× with drift (WhatsApp creates Contact; social doesn't). `runAgentReply`/`runMetaAgentReply`/`runWebchatAgentReply` ~90% identical (`agent-reply.ts:90-219`). Webhook skeleton copy-pasted per provider.
19. **No domain-mutation abstraction.** Custom-field required-check block copy-pasted 5× with `REQUIRED:` string sentinel (`contacts.ts:92`, `companies.ts:43`, `deals.ts:87`, `objects.ts:248,278`). `FormState` re-declared ~15×. `deal_created` emitted from two places with divergent payloads (`deals.ts:111` vs `pipelines.ts:190`).
20. **Event emission scattered/asymmetric**: custom objects and associations emit nothing (no workflows/webhooks/activity); `company_deleted` never fires; updates never hit activity feed; webhooks cover only 4 event types.
21. **Parallel divergent write path**: public API `api-resources.ts:67-110` re-implements create without phone normalization, custom-field validation, workflow events, webhooks.
22. **5 files bypass RLS** (`api-keys`, `webhooks`, `widget`, `help`, `channels` use raw `prisma` with hand-written scoping); `help.ts:117` updates by bare `id` (guarded, but fragile).
23. **Three divergent AI prompt paths** — studio chat route (`api/agents/[id]/chat`) skips persona/safety scaffold and tools that production (`agent-reply.ts`) uses; only preview route matches production.
24. **Oversized components**: `workflow-canvas.tsx` (536 lines), `inbox/page.tsx` (442). Contacts/companies list pages line-for-line identical.

Also noted: knowledge retrieval is lexical-only, English-hardcoded `to_tsvector('english', …)` (`knowledge.ts:117`) — poor for Malay/Chinese content; no embeddings.

## 3. Remediation plan (phased, no functionality change)

**Phase 1 — Security hardening**
- Fail closed on missing webhook secrets; add TikTok signature verification; delete cross-tenant TikTok fallback.
- Allowlist template scope namespaces (`contact.*`, `deal.*`, `company.*`, `vars.*`, safe `trigger.*` fields); strip `channel` from scope.
- SSRF: resolve DNS before fetch, re-check each redirect hop (`redirect:"manual"` loop).
- `acceptInvite`: match invitee email. Login: dummy bcrypt on unknown user.
- Encrypt `accessToken`/`secret` columns (AES-GCM, env key) behind `encryptSecret`/`decryptSecret` helpers.

**Phase 2 — Correctness invariants**
- Migrations: unique dedupe key on messages (`workspaceId, waMessageId`), unique conversation natural key, `@@index([workspaceId, phone])` on contacts; convert find-or-create sites to `upsert` — fixes races and webhook-retry duplicates together.
- Cron to every minute (or */5); move scheduled-trigger dedupe out of `customFields` into a `WorkflowFire` table with unique key; `RUNNING` lease timeout + FAILED retry with backoff; snapshot `steps` onto `WorkflowRun` at suspend; re-resolve channel on resume.
- Atomic credit gate: reserve-then-settle via conditional `updateMany`.

**Phase 3 — Consolidation (pure refactor)**
- `ChannelAdapter` interface (`verify / resolveConnection / parseInbound / send`) — collapses 3 webhook handlers, 3 reply runners, 3 find-or-create paths.
- `mutateRecord()` domain helper: auth → validation → custom-field enforcement → write → `emitDomainEvent()` (single emitter for workflows + webhooks + activity). Kills 5× copy-paste, fixes asymmetric event coverage, unifies public API with Server Actions.
- Shared `FormState`; route the 5 raw-prisma files through `withTenant`.
- Split `workflow-canvas.tsx` (serialization module + `FieldInput` + `StepCard`); generic `ObjectListPage` for contacts/companies/deals.

**Phase 4 — Scale**
- Batch cron: indexed cross-workspace due-run query + bounded concurrency, drop serial workspace loop.
- Cursor pagination on list pages + deals board; fix custom-object N+1 with targeted `in` queries.
- Inbox realtime: 5s polling first, SSE later.
- AI reply generation onto durable queue with inbound-message idempotency key (Vercel Queues or workflow-run table reuse).

**Root cause**: no shared abstractions at the two fan-out points — channels (inbound/outbound) and domain mutations (events). Both grew by copy-paste. Phase 3 fixes the disease; Phases 1-2 fix the symptoms that hurt today.
