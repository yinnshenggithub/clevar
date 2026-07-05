# WhatsApp Web-Linked Channel — System Design

**Feature:** Expand the WhatsApp inbox beyond the Cloud API to support *any* WhatsApp number — personal WhatsApp app and WhatsApp Business app — via the linked-devices web protocol. Connect flow: a few clicks + QR scan (or phone-number pairing code).

**Status:** Designed 2026-07-05. Built same session.

---

## 1. Architecture

```
┌──────────────────────┐   HTTPS + X-Api-Key    ┌──────────────────────────┐
│  Next.js app (Vercel)│ ─────────────────────► │  Messaging gateway        │
│                      │  sessions / send / qr  │  (WAHA container,         │
│  /api/wa-web/events ◄───────────────────────  │   GOWS engine, Railway    │
│   HMAC-verified      │   webhooks: message,   │   Singapore, 1 container, │
│                      │   session.status       │   N sessions)             │
└─────────┬────────────┘                        └────────────┬──────────────┘
          │ withTenant (RLS)                                  │ session auth state
          ▼                                                   ▼
   Neon Postgres  ◄───────────────────────────────  Neon Postgres (same DB,
   (conversations, messages, wa_web_channels)       gateway-owned tables)
```

- **Gateway** = one always-on WAHA container (Apache-2.0, self-hosted image `devlikeapro/waha`), engine `GOWS` (Go WebSocket — lightest, most protocol-faithful; engine is swappable per config if one breaks). One session per connected number, session name = routing key. Sessions + auth state persisted to Postgres so restarts reconnect automatically. Scales to hundreds of numbers per container; shard by adding containers later.
- **App** never holds a WhatsApp socket (Vercel serverless cannot). It talks to the gateway over REST (Bearer/X-Api-Key) and receives events on `/api/wa-web/events` (HMAC-SHA256 over raw body, **strict**: 503 if secret unset — cron-route precedent, not the skip-if-unset webhook precedent).
- **Coexistence**: Cloud API channel untouched for BSP-grade sending; web-linked channels are additive. Both feed the same Conversation/Message tables and the same automation chain (workflows → agent rules → AI reply).

### Why not X
- **Hand-rolled Baileys service**: v7 still RC, live LID identity migration, ban-wave churn, supply-chain incidents (fake "anti-ban" packages stealing sessions). Protocol maintenance is undifferentiated heavy lifting; WAHA absorbs it and lets us swap engines.
- **Hosted unofficial APIs** (Whapi/Green-API/Maytapi…): $12–35/number/mo, identical ToS risk, data leaves our infra. Self-hosted marginal cost ≈ RAM (~$0.05–0.40/number/mo).
- **whatsapp-web.js**: one Chromium per number — disqualified on density.

### Risk posture (unofficial protocol)
Meta ToS-violating; bans possible and usually unrecoverable. Product stance copied from mainstream QR products (TimelinesAI/Umnico): explicit consent copy at connect time, neutral naming ("web-linked number"), Cloud API remains the recommended channel for outbound volume. Web-linked numbers are for human-paced inbox use; no broadcast/bulk features are exposed on them. Phone must come online at least every 14 days or WhatsApp unlinks companions.

---

## 2. Database schema (migration 28)

```sql
-- Control-plane (NO RLS): events resolve workspace by sessionName before tenant ctx.
CREATE TABLE "wa_web_channels" (
  "id"                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id"        UUID NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "session_name"        TEXT NOT NULL,            -- unique routing key, e.g. clv_ab12cd34…
  "phone_number"        TEXT,                     -- E.164, learned at WORKING
  "display_name"        TEXT NOT NULL DEFAULT 'WhatsApp (web-linked)',
  "status"              TEXT NOT NULL DEFAULT 'starting',
                        -- starting | scan_qr | working | failed | logged_out | stopped
  "auto_reply_agent_id" UUID,
  "enabled"             BOOLEAN NOT NULL DEFAULT true,
  "last_seen_at"        TIMESTAMPTZ,
  "created_at"          TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ON "wa_web_channels"("session_name");
CREATE INDEX ON "wa_web_channels"("workspace_id");

-- Per-conversation channel binding (fixes the findFirst-per-workspace ambiguity).
ALTER TABLE "conversations" ADD COLUMN "channel_id" UUID;  -- polymorphic, nullable (legacy rows)
```

- `Conversation.channelType` gains value **`whatsapp_web`** (free string column — no migration needed for the value itself).
- `Message.mediaId` namespace: web-linked media stored as **`ww:<gateway file path>`** — free string column, cannot collide with numeric Graph ids.
- Dedupe: ingest guards on `(conversationId, waMessageId)` in code before insert (gateway may redeliver). DB-level partial unique index deferred (existing rows unaudited).

## 3. File structure

```
src/lib/wa-web.ts                     gateway client + waWebConfigured() + HMAC verify
src/lib/inbox-ingest.ts               EXTRACTED shared inbound pipeline (contact upsert,
                                      channelType-filtered conversation find-or-create,
                                      dedupe, reopen semantics, automation chain)
src/lib/actions/wa-web.ts             server actions: create/pair/disconnect/update channel
src/app/api/wa-web/events/route.ts    gateway webhook ingest (HMAC, ack-200 + after())
src/app/api/wa-web/status/[id]/route.ts  connect-flow poll endpoint (session-authed): status+QR
src/components/app/wa-web-connect.tsx client connect wizard (poll 3s, QR/pairing-code states)
docs/wa-web-gateway-setup.md          Railway deploy runbook + env vars
prisma/migrations/28_wa_web_channel/  SQL above
```

**Modified:** `prisma/schema.prisma` (WaWebChannel model + Conversation.channelId) · `src/app/api/whatsapp/webhook/route.ts` (use shared ingest; add `channelType:'whatsapp'` filter; set channelId) · `src/lib/actions/inbox.ts` (`whatsapp_web` reply branch, text+media) · `src/lib/actions/macros.ts` (per-channelType dispatch — fixes existing mis-send bug) · `src/lib/agent-reply.ts` (`runWaWebAgentReply` sibling) · `src/lib/workflow/types.ts` + `actions.ts` + `index.ts` (ctx.channel → serializable `{kind:'whatsapp'|'whatsapp_web', id}`, resolved at send time; stop dropping on Wait — fixes existing post-Wait no-op bug) · `src/app/api/whatsapp/media/[mediaId]/route.ts` (`ww:` branch → stream from gateway) · `src/app/app/inbox/page.tsx` (CHANNEL_LABEL, empty state, nav button) · `src/app/app/inbox/channels/page.tsx` (web-linked card).

## 4. Flows

**Connect (few-click):** Channels page → "Link a number" → server action creates `wa_web_channels` row (status `starting`) + gateway session with webhook config → client polls `/api/wa-web/status/[id]` every 3s → gateway hits `scan_qr` → UI shows QR (refetch on each poll; QR rotates ~60s/20s, max ~6 codes) with countdown + alternative "enter your phone number → 8-char code" (pairing code, marked beta) → user scans via WhatsApp ▸ Linked devices → gateway → `working` webhook updates row (+phone number) → UI flips to connected. Failure → `failed` + Retry CTA (restart session).

**Inbound:** gateway webhook `message` → verify HMAC → resolve channel by sessionName (control-plane) → shared ingest inside withTenant: contact find-or-create by E.164, conversation find-or-create by `{customerPhone, channelType:'whatsapp_web'}` + `channelId`, dedupe by message id, INBOUND message (media: `ww:` id), reopen conversation → ack 200 → `after()`: runWorkflows(`message_received`, ctx.channel=`{kind:'whatsapp_web', id}`) → agent rules → `runWaWebAgentReply`.

**Outbound (all 4 send sites):** resolve conversation's channel by `channelId` (fallback: workspace default per channelType) → `whatsapp_web` → gateway `sendText`/media with chatId `<digits>@c.us`; persist OUTBOUND message with returned id.

**Media:** gateway stores files (Railway volume); app proxies `ww:` ids through existing `/api/whatsapp/media/[mediaId]` route (RLS ownership check unchanged) with gateway API key. Inbox UI unchanged.

**Status webhooks:** `session.status` → update row (`working`/`failed`/`logged_out`…); `logged_out` keeps row for one-click relink.

## 5. Env vars

| Where | Var | Purpose |
|---|---|---|
| Vercel | `WA_WEB_GATEWAY_URL` | gateway base URL |
| Vercel | `WA_WEB_GATEWAY_API_KEY` | app→gateway auth |
| Vercel | `WA_WEB_WEBHOOK_SECRET` | gateway→app HMAC (strict) |
| Railway | `WAHA_API_KEY` (= API key above), `WHATSAPP_DEFAULT_ENGINE=GOWS`, Postgres session storage URL (Neon), webhook HMAC key, files lifetime | see runbook |

Feature is **inert until configured** (like Meta/TikTok OAuth): channels page shows the card with setup copy; everything else no-ops gracefully.

## 6. Scale path
1 container ≈ hundreds of sessions → shard containers by workspace hash (gateway URL per channel row — `wa_web_channels` can gain `gateway_url` later). Media → S3-compatible store. Sends → queue with per-number pacing when outbound automation volume grows. Realtime inbox → SSE/poll (today: SSR + revalidate, unchanged).
