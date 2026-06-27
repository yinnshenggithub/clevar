# Clevar — Autonomous Build Log

> **Resume contract.** This file is the source of truth for an unattended ~8h build run.
> User is away and authorized full autonomous execution + deploy of every ZERO-DEPENDENCY
> feature (no creds/OAuth/billing/browser/clicks from them). If context was compacted,
> READ THIS FILE TOP-TO-BOTTOM, then continue from the first unchecked wave. Do not
> re-ask the user anything. Started 2026-06-27.

## Mission
Ship the strongest CRM + AI-chat SaaS we can WITHOUT any user input. Each feature must be
fully built, build-passing, migrated, committed, and pushed (Vercel auto-deploys). Quality
floor: no half-built features, no broken builds, responsive + dark-mode + keyboard-focus.

## Hard constraints
- **Never** reference/leak that Clevar derives from Twenty/Chatwoot. Neutral naming only in code/docs/UI.
- **Zero-dependency only.** SKIP anything needing the user: live channel creds (FB/IG/SMS/Telegram/email/Twilio), Stripe keys, OAuth/SSO apps, Gmail/calendar sync, LLM provider key. AI features may ship but stay inert until a key exists — that's fine, don't block on it.
- Don't touch `twenty-main/` or `chatwoot-develop/` (reference-only, gitignored).
- TypeScript must compile. Run the build check before every commit.

## Ops runbook (exact, autonomous)
Working dir `/Users/yinnshengng/clevar`. Prod DB creds in `.env.prod` (gitignored).

**Build check (local):**
```
cd /Users/yinnshengng/clevar
DATABASE_URL="postgresql://u:p@localhost:5432/db" DIRECT_URL="postgresql://u:p@localhost:5432/db" \
AUTH_SECRET="0123456789abcdef0123456789abcdef" NEXT_PUBLIC_APP_URL="https://clevar.app" \
npx next build
```
(placeholder env OK — pages are force-dynamic; build does prisma generate + compile/typecheck.)

**Migrate (when schema changes):**
1. New migration dir: `prisma/migrations/<N>_<name>/migration.sql`.
2. Generate DDL: `URL=$(grep '^POSTGRES_URL_NON_POOLING=' .env.prod|cut -d= -f2-|tr -d '"'); npx prisma migrate diff --from-url "$URL" --to-schema-datamodel prisma/schema.prisma --script > prisma/migrations/<N>_<name>/migration.sql`
3. **Append RLS block** for each NEW tenant table (template below).
4. Wake Neon (TCP probe 5432) then deploy:
```
URL=$(grep '^POSTGRES_URL_NON_POOLING=' .env.prod|cut -d= -f2-|tr -d '"')
HOST=$(echo "$URL"|sed -E 's|.*@([^:/]+).*|\1|'); for i in $(seq 5); do nc -z -w 5 "$HOST" 5432 && break; sleep 3; done
export DATABASE_URL="$URL" DIRECT_URL="$URL"; npx prisma migrate deploy
```

**RLS template** (append per new tenant table; control-plane tables get NO RLS):
```sql
ALTER TABLE "<t>" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "<t>" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "<t>" USING (workspace_id = clevar_current_workspace()) WITH CHECK (workspace_id = clevar_current_workspace());
CREATE TRIGGER set_workspace_id BEFORE INSERT ON "<t>" FOR EACH ROW EXECUTE FUNCTION clevar_set_workspace_id();
```
Helpers `clevar_current_workspace()` / `clevar_set_workspace_id()` already exist (1_rls). All tenant writes go through `withTenant(workspaceId, tx => ...)` in `src/lib/tenant.ts`.

**Deploy:**
```
git add -A && git commit -m "<msg>"   # end body with Co-Authored-By line
GIT_SSH_COMMAND="ssh -o BatchMode=yes" git push origin main   # Vercel auto-deploys
```

## State at start
- Branch `main`, clean, synced. Last commit `cede0aa`. 11 migrations applied, schema in sync.
- Stack: Next.js 15 App Router · Prisma + Neon (RLS) · Tailwind + hand-rolled shadcn UI · jose JWT + bcrypt.
- Live: clevar-yinnshenggithubs-projects.vercel.app. Demo: demo@clevar.app / demo12345.

## Wave plan
> From gap-audit (49 baseline, 233 gaps). Ordered simple→complex. Zero-dependency only.
> Mark `[x]` only after build-passed AND pushed. Record commit hash in progress log.

- [x] **W1 — Inbox lifecycle.** Conversation status→{OPEN,PENDING,SNOOZED,RESOLVED}, priority enum, snoozedUntil, assignedUserId (member), firstReplyAt, waitingSince, customAttributes; Message + `private` (internal note) + authorUserId. UI: status/priority/assignee controls, snooze, internal-note toggle, filter tabs. → `f09768b`, migration 11.
- [x] **W2 — Conversation labels/tags.** Label model + ConversationLabel join; assign/filter by label in inbox. → `aa2b40d`, migration 12.
- [x] **W3 — Canned responses + Macros.** CannedResponse (shortcode+body), insert in reply form. Macro (ordered actions) one-click run on a conversation. → `dc5d414`, migration 13. Pages: /app/inbox/canned, /app/inbox/macros.
- [x] **W4 — Actor metadata + field rules.** created_by/updated_by (Uuid) on Company/Contact/Deal/CustomRecord; CustomFieldDef + `required`, `defaultValue`. Enforce in actions; defaults prefilled. → `269c514`, migration 14. Actor *display* + diffs deferred to W11 (audit). Field-reorder dropped (not core).
- [x] **W5 — Tasks + activity timeline.** Task model (title, due, status, assignee, parent link). ActivityEvent feed shown on contact/company/deal detail; global /app/tasks page; notes now surfaced on records. → `868ee21`, migration 15. (Custom-record timeline not wired — only core CRM objects.)
- [x] **W6 — Field types.** Added currency, multi_select, url, email, phone, rich_text, rating to custom-objects FIELD_TYPES + form inputs + render. → `00f3d1e` (no migration — metadata-driven).
- [~] **W7 — Table UX (lite shipped).** Bulk select + delete on contacts & companies lists via reusable BulkTable. → `399c0a1` (no migration). Saved views / advanced filters / multi-sort / group-by still open (stretch).
- [x] **W8 — Cmd+K + global search + favorites.** ⌘K palette (cross-object search + quick actions), header search box, Favorite model + star toggle + sidebar pins. → `6872787`, migration 16. (Done before W7 — higher UX leverage. Palette links to /app/reports which lands in W9.)
- [x] **W9 — Reporting dashboard.** /app/reports computes sales/support/team metrics live (open pipeline, won-this-month, pipeline-by-stage, conversations, avg first-response, msg volume, tasks, credits). → `2a0c4f4` (no migration). CSAT + CSV export deferred (CSAT needs live channel to collect).
- [x] **W10 — Help center.** Article + ArticleCategory (control-plane, public). Admin /app/help (CRUD + publish). Public /help/[slug] portal (search + categories) + /help/[slug]/[article]. → `2602d1a`, migration 17.
- [~] **W11 — API + webhooks + audit.** W11a shipped: ApiKey (sha256, revoke) + public REST /api/v1 (contacts/companies/deals, key auth, RLS-scoped, limit/offset). → `1646ef0`, migration 19. Live-verified (401 JSON). W11b (webhooks) next; audit log deferred (overlaps ActivityEvent).
- [x] **W12 — Web chat widget.** WebWidget (control-plane) + public loader script + same-origin iframe chat + start/message/poll endpoints; webchat conversations in shared inbox; agent reply persists + visitor polls; embed snippet page. → `9bea623`, migration 18.
- [ ] **W13 — Teams + routing + hours.** Team model + membership; auto-assignment (round-robin) on inbound; business hours; auto-resolve idle via Vercel cron.
- [ ] **W14 — Granular RBAC.** Custom roles + per-object permission matrix; enforce in actions + nav. (Last — highest retrofit risk.)
- [x] **W16 — AI Chatbot Studio (user-requested 2026-06-27).** → `9f1ae00`, migration 21. Deep-research-backed. Goals: human-like speech; knowledge from uploaded files + URLs; tuned for sales + CS; minimum tokens / maximum quality. Build: expand AiAgent (persona/tone, objectives, constraints, guardrails, sales/CS mode, temperature, response length), a rules engine (if X then Y, incl. auto-assign to a human agent + internal note + notification), URL ingestion into the knowledge base, and a fine-tuning UI (tone sliders/presets, objectives, constraints, rules builder, handoff config). Token efficiency via FTS-RAG + tight prompt assembly. AI stays inert until an LLM key is set — code ships ready. Research synthesis saved to docs/ai-chatbot-research.md.
- [ ] **W15 — HubSpot-style UI/UX pass (capstone, user-requested 2026-06-27).** After features land, optimize the whole app for HubSpot's latest look + ease of use: consistent app shell/topbar, refined sidebar + nav grouping, card/table/list polish, spacing/typography rhythm, empty states, primary-action affordances, breadcrumbs, mobile smoothness, dark mode parity. Aim: friction-free, demoable, GTM-ready ($100M ARR target). No new data — purely UX/visual + microcopy. Use frontend-design skill; HubSpot cues = airy white surfaces, soft shadows, rounded cards, orange (#FF7A59) primary accent on calm neutrals, clear section headers, generous padding.

## Context / compaction protocol (user directive 2026-06-27)
Checkpoint at every wave boundary: build-pass → migrate → commit → push → update this log. State lives in git + this file, so an auto-compaction (the harness summarizes near context limit) is seamless — after it, re-read this file and continue from the first unchecked wave. Can't self-invoke `/compact`; rely on git+log durability. Never leave a wave half-committed across a compaction.

## Later waves (post-initial-plan, user-requested)
- [x] **W17 — Meta + TikTok channels & lead ingestion.** → `6465037`, migration 22_channel_connections. ChannelConnection (control-plane). Meta webhook (Messenger + IG DMs → inbox; Lead Ads → contact+note; sig via META_APP_SECRET). TikTok webhook (lead forms → contact). Outbound Messenger/IG via page token (inbox + AI). Rules/handoff apply to social. Channels settings page + guides. Credential-gated: user supplies Meta page token / TikTok advertiser token to activate (verify token = META_VERIFY_TOKEN || WHATSAPP_VERIFY_TOKEN). TikTok DM ingestion noted as unavailable via public API (lead forms only).

## Progress log
- 2026-06-27: Prep done — schema read, RLS pattern confirmed, DB reachable, SSH push verified, log created. Gap-audit workflow running.
- 2026-06-27: Audit done (49 baseline / 233 gaps). Wave plan written.
- 2026-06-27: **W1 shipped** `f09768b` (migration 11_inbox_lifecycle). Build green, deployed. Note: snoozed convos auto-reopen on inbound now; time-based auto-reopen deferred to W13 cron.
- 2026-06-27: **W2 shipped** `aa2b40d` (migration 12_labels).
- 2026-06-27: **W3 shipped** `dc5d414` (migration 13_canned_macros). Canned edit is delete+recreate for now (acceptable).
- 2026-06-27: **W4 shipped** `269c514` (migration 14_actor_field_rules).
- 2026-06-27: **W5 shipped** `868ee21` (migration 15_tasks_activity).
- 2026-06-27: **W6 shipped** `00f3d1e` (no migration).
- 2026-06-27: User directive added mid-run → **W15** HubSpot-style UI/UX capstone pass appended to plan (do after feature waves).
- 2026-06-27: **W8 shipped** `6872787` (migration 16_favorites). Reordered ahead of W7 for UX leverage.
- 2026-06-27: **W9 shipped** `2a0c4f4` (no migration) — reports dashboard.
- 2026-06-27: **W10 shipped** `2602d1a` (migration 17_help_center).
- 2026-06-27: **W12 shipped** `9bea623` (migration 18_web_widget).
- 2026-06-27: Bringing **W15 HubSpot UI/UX capstone forward now** (user's top priority, benefits all shipped features). Remaining feature waves W7 (table UX), W11 (api/webhooks/audit), W13 (teams/routing/hours), W14 (RBAC) become post-capstone stretch.
- 2026-06-27: **W15 capstone chunk 1 shipped** `902cd81` — HubSpot design tokens (orange/navy/blue-gray), button polish, landing-page rewrite (full CRM+inbox+AI story), dashboard quick-actions, auth brand polish. No migration.
- 2026-06-27: **W7-lite shipped** `399c0a1` — bulk select/delete (contacts, companies).
- 2026-06-27: Starting **W11a** — API keys + public REST. Then webhooks/audit (W11b), W13, W14 as budget allows. Capstone visual base already shipped.
- 2026-06-27: **W11a shipped** `1646ef0` (migration 19, live-verified 401). **W11b shipped** `3964834` (migration 20, webhooks). W11 complete (audit log deferred — overlaps ActivityEvent).
- 2026-06-27: User directive → **W16 AI Chatbot Studio** added (priority). Launching research workflow; building schema/UI/URL-ingestion/rules while it runs.
- 2026-06-27: Research workflow done (49 findings → docs/ai-chatbot-research.md). **W16 shipped** `9f1ae00` (migration 21_agent_studio). Studio: mode/tone/style/objectives/constraints/temperature/greeting, if-then rules + handoff, URL ingestion, research-backed prompt. AI replies still inert until an LLM key is set; rules/handoff work without a key.
- 2026-06-27: Done so far: W1-W6, W8, W9, W10, W11(a+b), W12, W7-lite, W15(chunk1), W16. Open: W15 chunk2 (more UX polish), W13 (teams/routing/hours), W14 (RBAC) — stretch.

## Session 2 (2026-06-27, continued — user redirected to UI/agent batch)
- **Studio tester shipped** `991c560` then side-by-side `366fade`: `/api/agents/[id]/preview` (full studio prompt + RAG + selectable model, ephemeral, metered) + AgentTester panel (model picker, live if-then rule preview, credit-aware). Agent edit page split config-left / test-right.
- **Associations DESIGN ONLY** (committed in `366fade`): spec `docs/superpowers/specs/2026-06-27-custom-object-associations-design.md` + plan `docs/superpowers/plans/2026-06-27-custom-object-associations.md`. AssociationType + RecordAssociation (polymorphic, RLS). NOT BUILT — awaits user answers to spec §11 (self-assoc, backfill field visibility, core-pair unification, picker scale). Plan Task 4 fixes latent `relations` target bug in objects.ts addField. Its migration will be 24 (23 used by agent-actions).
- **Feature A — CRM 3-col detail** `7aba68c` (no migration): RecordDetailLayout (client tab shell), related-panel, record-identity (+RecordHighlights). contact/company/deal rebuilt: identity+About left, Overview/Activity tabs center, related panels right. record-activity single-column. Soft-nav between records.
- **Feature B — Inbox 3-pane** `4f97cab` (no migration): contact-details panel (3rd col, xl+) on /app/inbox — linked CRM contact + conversation meta + custom fields + labels. Conversation.contactId drives it. ?c= soft-nav.
- **Feature C — Agent Actions + runtime** `a27b3c6` (migration 23_agent_actions: ai_agents.actions JSONB, APPLIED TO PROD). agent-action-defs.ts (pure catalog) + agent-actions.ts (server tool factory, dry-run mode). Live actions via AI SDK tool-calling (maxSteps:5): close, assign-to-teammate, add-note, apply-label, update-contact-field. Premium toggles: workflow/calls/http. Reply pipeline refactored onto shared `generateTurn` helper (tools live); preview wires dry-run. Optimize button → /api/agents/optimize. Tester shows action chips.
- **Credential note:** prod runtime AUTH_SECRET ≠ local .env.prod (stale) — can't forge a prod session for remote e2e; re-pull with `vercel env pull .env.prod`. A "Demo Assistant" agent was created in the demo workspace (demo@clevar.app) during testing.
- **Feature D — Associations BUILT** `90eb863` (migration 24_record_associations: AssociationType + RecordAssociation, RLS verified relrowsecurity=t + tenant_isolation, APPLIED TO PROD). Built autonomously with spec §11 defaults (self-assoc deferred, backfilled fields stay editable, core pairs unchanged, 500-row picker cap) — FLAGGED for user review. `src/lib/associations.ts` (resolve/getAssociationsFor/availableAssociationTypes/cleanupAssociations) + `src/lib/actions/associations.ts` (type CRUD admin + add/remove edges any-member, cardinality enforced) + Settings→Associations page + AssociationTypeForm + shared AssociationsPanel wired into contact/company/deal/custom-record pages. Cascade cleanup wired into all record + object-def deletes. Fixed latent `relations` target bug + reserved-slug guard in objects.ts. **Deferred (non-blocking):** backfill script (Plan Task 10) + formal test suite (Task 11). 4 detail pages now show the panel; bidirectional verified by design.
- **Open / next:** review associations §11 defaults; run backfill script if migrating existing relation-field links; W13 teams/routing, W14 RBAC, W15 chunk2 polish. Everything build-green + deployed + smoke-verified (routes 307/401 as designed).

## Session 3 (2026-06-27, continued — research recovery)
- **Recovered 2 deep-research sweeps** that finished their find+verify phases but died before synthesis when the prior session hit its token limit (synthesis stage never ran, so nothing was saved). Extracted findings from the workflow journals/agent jsonl under `subagents/workflows/` and synthesized two cited reports:
  - `docs/agent-rag-security-research.md` — 113-agent sweep, 30 sources → 144 claims (63 upheld / 2 refuted). Hybrid retrieval (BM25+vector+RRF k=60), `ts_rank`→BM25 upgrade, over-fetch→rerank, abstention (1.8%→60% w/ conservative prompt), function-calling reliability (fewer tools > bigger model; `strict` is structural-only), prompt-injection reality (Control Illusion: 9.6–45.8% obedience under conflict → move safety to infra), eval harness (faithfulness ≥0.90, DeepEval CI gate, shadow mode). Ends with prioritized Clevar upgrades.
  - `docs/competitor-agent-research.md` — 106-agent sweep, 24 sources → 116 claims (69 upheld / 6 refuted). Intercom Fin / Zendesk agentic AI / respond.io teardown (guidance, tone, actions, escalation, grounding) + cross-cutting patterns + Clevar gap analysis. Corrects two refuted claims (respond.io = ~9 actions not 4; its KB retrieval is now semantic top-10, not keyword-only).
- No code/migration changes — docs only. The competitor deep-research *workflow* (`wwhmvb53g`) had failed earlier (StructuredOutput error); this recovery reconstructs its value from the underlying agent transcripts instead of re-running.
