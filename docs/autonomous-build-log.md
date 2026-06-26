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
- [ ] **W2 — Conversation labels/tags.** Label model + ConversationLabel join; assign/filter by label in inbox.
- [ ] **W3 — Canned responses + Macros.** CannedResponse (shortcode+body), insert in reply form. Macro (ordered actions) one-click run on a conversation.
- [ ] **W4 — Actor metadata + field rules.** created_by/updated_by (Uuid) on Company/Contact/Deal/CustomRecord; CustomFieldDef + `required`, `defaultValue`. Enforce in actions; show creator.
- [ ] **W5 — Tasks + activity timeline.** Task model (title, due, status, assignee, parent link). ActivityEvent feed (record/field-change/note/task) shown on contact/company/deal/record detail.
- [ ] **W6 — Field types.** Add currency, multi_select, url, email, phone, rich_text, rating to custom-objects FIELD_TYPES + form inputs + render.
- [ ] **W7 — Saved views + table UX.** SavedView (object, filters json, sort, group, columns); advanced filter builder, multi-sort, group-by, column show/hide, bulk delete/select on CRM lists + custom objects.
- [ ] **W8 — Cmd+K + global search + favorites.** Workspace-wide ranked search across objects; command palette; Favorite model + sidebar pins.
- [ ] **W9 — Reporting + CSAT.** ReportingEvent capture (first response, resolution, reply time); overview/agent/inbox dashboards; CSAT model + metrics. CSV export of reports.
- [ ] **W10 — Help center.** Portal + Category + Article (public, FTS, slugs); public route; admin authoring UI.
- [ ] **W11 — API + webhooks + audit.** ApiKey (hash, scopes, revoke), public REST under /api/v1 with key auth + workspace scoping + pagination; Webhook (url, events, secret) + delivery on events; AuditLog (actor, action, entity, diff) + viewer.
- [ ] **W12 — Web chat widget.** Public embeddable widget (JS snippet + iframe/script), public message endpoints, new channelType "webchat" routed into the same inbox; widget appearance settings.
- [ ] **W13 — Teams + routing + hours.** Team model + membership; auto-assignment (round-robin) on inbound; business hours; auto-resolve idle via Vercel cron.
- [ ] **W14 — Granular RBAC.** Custom roles + per-object permission matrix; enforce in actions + nav. (Last — highest retrofit risk.)

## Progress log
- 2026-06-27: Prep done — schema read, RLS pattern confirmed, DB reachable, SSH push verified, log created. Gap-audit workflow running.
- 2026-06-27: Audit done (49 baseline / 233 gaps). Wave plan written.
- 2026-06-27: **W1 shipped** `f09768b` (migration 11_inbox_lifecycle). Build green, deployed. Note: snoozed convos auto-reopen on inbound now; time-based auto-reopen deferred to W13 cron.
