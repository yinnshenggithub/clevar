# WhatsApp Business App Connect (Coexistence) — Meta Approval & Setup Runbook

This is the operator runbook for turning on the **"Connect WhatsApp Business app"** button on
`/app/inbox/channels`. The feature lets a customer link the number already on their WhatsApp
Business app to Clevar through Meta's official platform: the phone app keeps working, both sides
stay in sync, and up to 180 days of chat history + their contact book import automatically.

The code is already deployed and **inert** until three environment variables are set (step 7).
Everything before that is Meta-side paperwork. Budget **2–4 weeks** end-to-end; every step below
is free — Meta charges no platform fees.

---

## 0 · What you're applying for (mental model)

To let *other businesses* onboard through your app, Meta requires you to be a **Tech Provider**.
That means, in order:

1. **Business Verification** of your own company (CLEVAR / JOM EINVOICE entity) — proves you exist.
2. **App Review** granting *Advanced Access* to two permissions — proves your app is legitimate:
   - `whatsapp_business_messaging` (send/receive on behalf of clients)
   - `whatsapp_business_management` (access client WABAs, templates)
3. **Access Verification** — a follow-up check that confirms you operate as a Tech Provider.
4. An **Embedded Signup configuration** — the popup your customers click through.

No separate approval exists for Coexistence itself — once you're a Tech Provider with Embedded
Signup, the Business-app onboarding path is available. (It is enabled per-flow by the
`featureType: whatsapp_business_app_onboarding` parameter the code already sends.)

---

## 1 · Prerequisites (before you start)

- A **Meta Business Portfolio** (business.facebook.com) owned by the company, with you as admin.
- Legal-entity documents matching the portfolio's business name exactly: company registration
  (SSM for Malaysia), utility bill or bank statement showing the business address, and a company
  website or public listing that shows the business name.
- A **privacy policy URL** on your production domain (required for App Review).
- Your production app URL live (Embedded Signup requires HTTPS domains, no localhost).

## 2 · Meta app setup (developers.facebook.com)

Reuse the existing Clevar Meta app if it's a **Business-type** app; otherwise create a new one:

1. My Apps → Create App → use case **Other** → type **Business** → link it to your Business Portfolio.
2. App dashboard → add the **WhatsApp** product.
3. Add **Facebook Login for Business** product (Embedded Signup runs on it).
4. App Settings → Basic: set app icon (1024×1024), category (e.g. *Business and pages*),
   **privacy policy URL**, and your domain in *App domains*. Fill Data Protection Officer contact
   if asked.
5. WhatsApp → Configuration → **Webhook**:
   - Callback URL: `https://<your-domain>/api/whatsapp/webhook`
   - Verify token: the value of `WHATSAPP_VERIFY_TOKEN` in your server env.
   - Subscribe to webhook fields: `messages`, **`smb_message_echoes`**, **`history`**,
     **`smb_app_state_sync`**, `account_update` — and if listed, `account_offboarded` /
     `account_reconnected`. (The coexistence fields are what mirror the phone app into Clevar.)

## 3 · Business Verification (2–5 business days)

business.facebook.com → Settings → **Security Centre** → *Start Verification*.
Submit the legal documents from step 1. Common rejection causes: document name/address not
matching the portfolio's business name exactly, or an unreachable phone number during the
confirmation call/SMS. Fix and resubmit — no penalty for retries.

## 4 · App Review — Advanced Access (3–5 business days after submission)

App dashboard → **App Review → Permissions and Features**. Request **Advanced Access** for:

- `whatsapp_business_messaging`
- `whatsapp_business_management`

Each request needs:

1. **A screen recording** demonstrating the permission in real use. Record two videos against your
   production Clevar with a test WABA:
   - *Messaging video*: connect a number, show a customer message arriving in the Clevar inbox,
     reply from Clevar, show it delivered on the phone.
   - *Management video*: show the connect flow (Embedded Signup popup end-to-end) and the channel
     appearing under Inbox → Channels.
2. **Written reviewer instructions**: a short script of what the video shows, plus a demo login
   for the reviewer (create a throwaway workspace account; put credentials in the notes field).
3. **Data-handling questionnaire**: answer honestly — messages are stored to provide the CRM inbox,
   tokens are stored server-side, no data sold, deleted on disconnect.

Tips that avoid the common rejection loop:
- The videos must show YOUR app (real domain visible in the browser bar), not Meta's dashboards.
- Every permission you request must be visibly exercised in a video.
- App must be switched **Live** (App Mode: Live) before review can complete.

## 5 · Tech Provider Access Verification (~5 business days)

After Advanced Access is granted, Meta prompts an **Access Verification** step in the app dashboard
(under App Review). It confirms you operate a multi-client platform (Tech Provider). You'll restate
your company details and how clients onboard (answer: self-serve via Embedded Signup inside your
SaaS). No credit line is needed — that's only for full Solution Partners/BSPs.

## 6 · Create the Embedded Signup configuration

1. App dashboard → **Facebook Login for Business → Configurations → Create configuration**.
2. Choose the template **"WhatsApp Embedded Signup Configuration"** (the token variant is fine —
   the server exchanges the code for a business token either way).
3. Keep the default assets (WABA + phone number) selected; save.
4. Copy the **Configuration ID** — this is `NEXT_PUBLIC_META_ES_CONFIG_ID`.

Note: Embedded Signup **v2 is deprecated on October 15, 2026**. The Clevar integration already
uses the current (v3+) session-info flow, so nothing to do — just don't copy any v2 sample code
from old blog posts.

## 7 · Turn it on (Vercel env)

Set in the production environment and redeploy:

```
NEXT_PUBLIC_META_APP_ID=<app id from App Settings → Basic>
META_APP_SECRET=<app secret from App Settings → Basic>
NEXT_PUBLIC_META_ES_CONFIG_ID=<configuration id from step 6>
WHATSAPP_VERIFY_TOKEN=<any random string; must match the webhook config in step 2>
WHATSAPP_APP_SECRET=<same value as META_APP_SECRET — signs webhook payloads>
```

The "Connect WhatsApp Business app" button appears on Inbox → Channels once all three of the
first group are present.

## 8 · Test the flow end-to-end

Use a real WhatsApp Business app number you control (Meta gates Coexistence eligibility by
account age/quality — a freshly created Business app account may be refused; use one that has
been active for a while):

1. Channels page → *Connect WhatsApp Business app* → complete Facebook login → choose
   **"Connect your existing WhatsApp Business app"** → enter the number → scan the QR with the
   Business app (Settings → Business tools → WhatsApp Business Platform) → approve history share.
2. Within ~2 minutes the channel row shows **Connected**; contacts and recent chats appear first,
   older history back-fills over the next minutes.
3. Send a message from the phone app → it appears in the Clevar thread as an outbound message.
4. Reply from Clevar → it appears in the phone app.

## 9 · Ongoing rules to tell customers (also shown in the UI)

- Keep the WhatsApp Business app **installed** and open it at least **once every 14 days**,
  or Meta disconnects the number. Don't uninstall the app.
- Messages sent from the phone stay **free**; messages sent from Clevar are billed by Meta at
  standard Cloud API per-message rates (customer-initiated service conversations are free).
- Coexistence numbers are capped at **20 messages/second** — fine for support, not for blasts.
- Not synced/supported: group chats, broadcast lists (become read-only), voice/video calls,
  disappearing/view-once messages. Voice notes/stickers sent **from the phone** may not appear
  in Clevar (Meta's echo webhook covers text/image/video/document only).
- One number per WhatsApp Business app account; the app's own quick replies/greeting tools are
  disabled after connecting (Clevar's automations replace them).

## 10 · Troubleshooting

| Symptom | Likely cause / fix |
| --- | --- |
| Connect button hidden | One of the three env vars missing, or user isn't owner/admin. |
| Popup opens then closes with no result | App not Live, or the domain isn't in *App domains* / Facebook Login allowed domains. |
| "Couldn't finish connecting with Meta" | Code exchange failed — check META_APP_SECRET matches the app, and server logs. |
| Connected but no history | Customer declined history share during the QR step (error 2593109 in logs) — disconnect and reconnect within 24h of onboarding, approving the share. |
| Channel shows "Disconnected from the app" | Customer offboarded from the phone (Business tools → WhatsApp Business Platform) — reconnect via the button. |
| Webhook 401s in logs | WHATSAPP_APP_SECRET doesn't match the app secret Meta signs with. |
