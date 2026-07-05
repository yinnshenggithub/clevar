# Messaging gateway setup (web-linked WhatsApp numbers)

The web-linked WhatsApp channel ("link your number" QR flow) needs one always-on
gateway container. The app is inert without it: the Channels page shows setup
copy and `/api/wa-web/events` returns 503 until the env vars below are set.

The gateway is the open-source **WAHA** image (`devlikeapro/waha`, Apache-2.0 —
all features free since 2026.6.1), run with the **GOWS** engine (browserless,
lightest, hundreds of sessions per container). One container serves every
workspace; sessions are isolated by unguessable session names.

## 1. Deploy on Railway (~5-10 USD/mo)

1. railway.com → **New Project** → **Deploy a Docker image** → `devlikeapro/waha:latest`
   (pin a specific tag, e.g. `devlikeapro/waha:2026.6.2`, and bump deliberately).
2. **Settings → Region**: Southeast Asia (Singapore).
3. **Settings → Networking → Public Networking**: generate the HTTPS domain — this is `WA_WEB_GATEWAY_URL`.
4. **Settings → Deploy**: Restart policy **Always**; set deployment **overlap/drain to 0s**
   (two live instances would fight over the same WhatsApp sockets).
5. **Variables** (generate two long random secrets first — `openssl rand -hex 32`):

   | Variable | Value |
   |---|---|
   | `WHATSAPP_DEFAULT_ENGINE` | `GOWS` |
   | `WAHA_API_KEY` | secret A (app → gateway auth) |
   | `WHATSAPP_SESSIONS_POSTGRESQL_URL` | Neon **direct** URL (`postgres://…?sslmode=require`) — sessions survive restarts/redeploys |
   | `WAHA_MEDIA_STORAGE` | `POSTGRESQL` |
   | `WAHA_MEDIA_POSTGRESQL_URL` | same Neon URL |
   | `WHATSAPP_FILES_LIFETIME` | `0` (keep media; inbox history references it) |
   | `WAHA_BASE_URL` | the public HTTPS domain from step 3 (used to build media URLs) |
   | `WAHA_PRINT_QR` | `False` |
   | `WAHA_DASHBOARD_ENABLED` | `False` (or set username/password and keep it) |
   | `TZ` | `Asia/Kuala_Lumpur` |

   Webhook HMAC (secret B) is configured **per session by the app**, not here.

6. Health check path: `/ping` (or `/health`).

## 2. Vercel env vars (app side)

| Variable | Value |
|---|---|
| `WA_WEB_GATEWAY_URL` | gateway HTTPS domain (no trailing slash) |
| `WA_WEB_GATEWAY_API_KEY` | secret A |
| `WA_WEB_WEBHOOK_SECRET` | secret B (HMAC key the app puts in each session's webhook config; `/api/wa-web/events` verifies `X-Webhook-Hmac`, SHA-512 over the raw body) |

Redeploy the app after setting them. Done — the Channels page switches to the
live "Link a number" flow.

## 3. How it flows

- **Pair**: app creates a gateway session (webhook → `NEXT_PUBLIC_APP_URL/api/wa-web/events`,
  events `message.any` + `session.status`, ignore stories/channels/broadcasts) →
  connect UI polls `/api/wa-web/status/[id]` (live status + QR) → user scans QR
  or types a pairing code → session `WORKING`.
- **Inbound**: gateway POSTs `message.any` → HMAC verify → resolve channel by
  session name → shared ingest (contact upsert, conversation per
  `customerPhone`+`channelType`, message-id dedupe) → workflows → agent rules →
  AI reply via gateway. Messages sent from the phone itself are mirrored as
  OUTBOUND.
- **Outbound**: inbox reply / macros / workflow send / AI reply resolve the
  conversation's channel (`Conversation.channelId`) and POST `sendText` /
  `sendImage`/`sendFile`/`sendVoice`/`sendVideo` (base64) to the gateway.
- **Media**: gateway stores files (Postgres); the app proxies `ww:`-prefixed
  media ids through `/api/whatsapp/media/[mediaId]` with the API key.

## 4. Operating notes

- **This is WhatsApp's linked-devices protocol, not an official API.** Bulk or
  spammy sending can get a number restricted or banned by WhatsApp, and bans
  are rarely recoverable. Keep it human-paced; the Cloud API channel remains
  the right transport for high-volume outbound.
- The user's phone must come online at least once every ~14 days or WhatsApp
  unlinks companions (channel drops to "Signed out" → Relink).
- A workspace can link multiple numbers; each is its own session + channel row.
- Engine escape hatch: if GOWS misbehaves, set `WHATSAPP_DEFAULT_ENGINE=NOWEB`
  and restart — same REST API, different protocol engine.
- Scale path: shard by adding gateway containers and a `gatewayUrl` column on
  `wa_web_channels`; move media to S3 (`WAHA_MEDIA_STORAGE=S3`).
