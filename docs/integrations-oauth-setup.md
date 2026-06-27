# One-click Meta & TikTok connect — setup

Clevar users connect their Facebook/Instagram Pages and TikTok advertiser
accounts with a single "Connect" click, granting access to **Clevar's** registered
app. They never create their own developer app. The OAuth flow writes the same
`ChannelConnection` rows the manual forms create, so the inbox / lead-gen wiring is
unchanged downstream.

## What's shipped

- `GET /api/oauth/meta` → Facebook Login dialog (with Clevar's app + scopes).
- `GET /api/oauth/meta/callback` → exchanges the code for a long-lived user token,
  lists the user's Pages (`/me/accounts`), and upserts a `ChannelConnection`
  (provider `meta`) per Page with its Page token, linked Instagram id, and
  `features:{messenger,instagram,leadgen}`.
- `GET /api/oauth/tiktok` + `/callback` → exchanges the code for an access token +
  authorized advertiser ids and upserts a `ChannelConnection` (provider `tiktok`)
  per advertiser.
- Settings → Inbox → Channels shows **Connect with Facebook / Connect with TikTok**
  buttons when configured; the manual paste forms remain under "Connect manually".
- CSRF: a one-time `oauth_nonce_*` httpOnly cookie is matched against the `state`
  param; the workspace is taken from the authenticated session, never the URL.

## To make it live (operator / one-time platform setup)

The code is inert until these server env vars are set (then the buttons appear):

| Env var | Source |
|---|---|
| `META_APP_ID`, `META_APP_SECRET` | a Meta app (developers.facebook.com) |
| `TIKTOK_APP_ID`, `TIKTOK_APP_SECRET` | a TikTok for Business app |
| `NEXT_PUBLIC_APP_URL` | already set — used to build redirect URIs |

**Meta app:**
1. Add **Facebook Login** product. Set the OAuth redirect URI to
   `https://<app-url>/api/oauth/meta/callback`.
2. Request these scopes (each needs **App Review** + Business Verification before
   the app can be used by people outside your dev/test users):
   `pages_show_list, pages_messaging, pages_manage_metadata, pages_read_engagement,
   leads_retrieval, instagram_basic, instagram_manage_messages, business_management`.
3. Switch the app to **Live** mode.

**TikTok app:**
1. In TikTok for Business, create an app with the **Lead Generation** (and Messaging,
   if granted) scopes. Set the redirect URI to
   `https://<app-url>/api/oauth/tiktok/callback`.
2. Submit for review / move to production.

## Known limits / next steps

- Until App Review passes, only the app's dev/test users can complete the Meta flow.
- Token refresh: Meta Page tokens from a long-lived user token are long-lived but not
  infinite; a refresh/expiry job is a follow-up. TikTok tokens likewise.
- The flow connects **all** granted Pages/advertisers; a picker to choose a subset is
  a possible refinement.
- Webhook subscription (messages/leadgen) is still configured per the manual setup
  docs; auto-subscribing the Page to the app's webhook on connect is a follow-up.
