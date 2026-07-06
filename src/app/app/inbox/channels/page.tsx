import Link from "next/link";
import { ArrowLeft, CheckCircle2, LogIn, AlertTriangle, Loader2 } from "lucide-react";
import { requireAuth, canManageWorkspace } from "@/lib/auth";
import { withTenant } from "@/lib/tenant";
import { prisma } from "@/lib/prisma";
import { disconnectChannel, disconnectWhatsAppChannel } from "@/lib/actions/channels";
import { disconnectWaWebChannel } from "@/lib/actions/wa-web";
import { metaConfigured, tiktokConfigured } from "@/lib/oauth";
import { waWebConfigured } from "@/lib/wa-web";
import { coexClientConfig } from "@/lib/wa-coex";
import { PageHeader } from "@/components/app/page-header";
import { MetaChannelForm, TikTokChannelForm } from "@/components/app/channel-forms";
import { WaWebConnect, WaWebChannelSettings, WaWebRelink } from "@/components/app/wa-web-connect";
import { WaCoexConnect, WaChannelSettings } from "@/components/app/wa-coex-connect";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const OAUTH_MESSAGES: Record<string, string> = {
  "connected=meta": "Facebook/Instagram connected.",
  "connected=tiktok": "TikTok connected.",
  oauth_state: "Connection expired or was tampered with — please try again.",
  meta_not_configured: "One-click Meta connect isn't enabled on this server yet.",
  tiktok_not_configured: "One-click TikTok connect isn't enabled on this server yet.",
  meta_no_pages: "No Facebook Pages were granted. Make sure you selected a Page.",
  meta_oauth_failed: "Couldn't complete the Facebook connection. Try again.",
  tiktok_no_advertisers: "No TikTok advertiser accounts were granted.",
  tiktok_oauth_failed: "Couldn't complete the TikTok connection. Try again.",
};

export const dynamic = "force-dynamic";

function Copyable({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <code className="mt-1 block break-all rounded-md border border-border bg-secondary px-2 py-1.5 text-xs">{value}</code>
    </div>
  );
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export default async function ChannelsPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string; count?: string }>;
}) {
  const ctx = await requireAuth();
  const manage = canManageWorkspace(ctx.role);
  const sp = await searchParams;
  const metaOauth = metaConfigured();
  const tiktokOauth = tiktokConfigured();
  const banner = sp.connected
    ? { ok: true, text: OAUTH_MESSAGES[`connected=${sp.connected}`] ?? "Connected." }
    : sp.error
      ? { ok: false, text: OAUTH_MESSAGES[sp.error] ?? "Something went wrong connecting." }
      : null;
  const [agents, meta, tiktok, waWebChannels, waChannels] = await Promise.all([
    withTenant(ctx.workspaceId, (tx) => tx.aiAgent.findMany({ where: { deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } })),
    prisma.channelConnection.findFirst({ where: { workspaceId: ctx.workspaceId, provider: "meta" } }),
    prisma.channelConnection.findFirst({ where: { workspaceId: ctx.workspaceId, provider: "tiktok" } }),
    prisma.waWebChannel.findMany({ where: { workspaceId: ctx.workspaceId }, orderBy: { createdAt: "asc" } }),
    prisma.whatsAppChannel.findMany({
      where: { workspaceId: ctx.workspaceId },
      // Deliberately no accessToken — keep the secret out of the RSC payload.
      select: {
        id: true,
        displayName: true,
        displayPhoneNumber: true,
        phoneNumberId: true,
        mode: true,
        status: true,
        autoReplyAgentId: true,
      },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  const waWebReady = waWebConfigured();
  const coexClient = coexClientConfig();
  const linkedNumbers = waWebChannels.filter((c) => c.status === "working" || c.phoneNumber);

  const base = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
  const verifyToken = process.env.META_VERIFY_TOKEN || process.env.WHATSAPP_VERIFY_TOKEN || "(set META_VERIFY_TOKEN)";
  const metaCfg = (meta?.config ?? {}) as any;
  const ttCfg = (tiktok?.config ?? {}) as any;

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title="Channels"
        description="Link WhatsApp numbers, Facebook Messenger, Instagram DMs, and TikTok lead forms."
        action={
          <Link href="/app/inbox">
            <Button variant="ghost" className="gap-2"><ArrowLeft className="h-4 w-4" /> Inbox</Button>
          </Link>
        }
      />

      {banner && (
        <div
          className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${banner.ok ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"}`}
        >
          {banner.ok ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
          {banner.text}
        </div>
      )}

      {(meta || tiktok) && (
        <div className="flex flex-wrap gap-2">
          {meta && (
            <span className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-sm text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="h-4 w-4" /> Meta: {metaCfg.pageName || meta.externalId}
            </span>
          )}
          {tiktok && (
            <span className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-sm text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="h-4 w-4" /> TikTok: {ttCfg.advertiserName || tiktok.externalId}
            </span>
          )}
        </div>
      )}

      {/* WhatsApp — official (Cloud API + Business-app coexistence) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">WhatsApp Business app — official</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Connect the number already on your WhatsApp Business app through Meta&apos;s official platform. The app keeps
            working on your phone, both stay in sync, and up to 6 months of chats import into your inbox.{" "}
            <Link href="/app/inbox/settings" className="underline underline-offset-2">
              Prefer manual Cloud API setup? Set it up here.
            </Link>
          </p>

          {waChannels.length > 0 && (
            <ul className="space-y-3">
              {waChannels.map((ch) => (
                <li key={ch.id} className="space-y-3 rounded-lg border border-border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    {ch.status === "offboarded" ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs text-amber-700 dark:text-amber-300">
                        <AlertTriangle className="h-3.5 w-3.5" /> Disconnected from the app
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-700 dark:text-emerald-300">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Connected
                      </span>
                    )}
                    <span className="inline-flex items-center rounded-full border border-border bg-secondary px-2.5 py-1 text-xs text-muted-foreground">
                      {ch.mode === "coexistence" ? "Business app" : "Cloud API"}
                    </span>
                    <span className="text-sm font-medium">{ch.displayName}</span>
                    <span className="text-sm text-muted-foreground">{ch.displayPhoneNumber ?? `ID ${ch.phoneNumberId}`}</span>
                  </div>
                  {manage && (
                    <>
                      <WaChannelSettings
                        channelId={ch.id}
                        displayName={ch.displayName}
                        autoReplyAgentId={ch.autoReplyAgentId}
                        agents={agents}
                      />
                      <form action={disconnectWhatsAppChannel.bind(null, ch.id)}>
                        <Button type="submit" variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10">
                          Disconnect number
                        </Button>
                      </form>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}

          {!manage && waChannels.length === 0 && (
            <p className="text-sm text-muted-foreground">Only owners and admins can connect channels.</p>
          )}
          {manage &&
            (coexClient ? (
              <WaCoexConnect appId={coexClient.appId} configId={coexClient.configId} />
            ) : (
              <div className="rounded-lg border border-border p-3">
                <p className="text-xs text-muted-foreground">
                  One-click connect isn&apos;t enabled on this server yet (admin: complete Meta approval and set{" "}
                  <code>NEXT_PUBLIC_META_APP_ID</code>, <code>META_APP_SECRET</code>, and{" "}
                  <code>NEXT_PUBLIC_META_ES_CONFIG_ID</code> — see <code>docs/meta-coexistence-approval.md</code>).
                </p>
              </div>
            ))}

          <p className="text-xs text-muted-foreground">
            Requires the WhatsApp Business app (v2.24.17+). Open the app at least once every 14 days to stay connected.
            Messages you send from the phone stay free; messages sent from Clevar are billed by Meta at standard Cloud
            API rates.
          </p>
        </CardContent>
      </Card>

      {/* WhatsApp — web-linked numbers */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">WhatsApp — link your number</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Pair the WhatsApp or WhatsApp Business app on your phone in a few clicks, like WhatsApp Web.{" "}
            <Link href="/app/inbox/settings" className="underline underline-offset-2">
              Using the official Cloud API instead? Set it up here.
            </Link>
          </p>

          {linkedNumbers.length > 0 && (
            <ul className="space-y-3">
              {linkedNumbers.map((ch) => (
                <li key={ch.id} className="space-y-3 rounded-lg border border-border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    {ch.status === "working" ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-700 dark:text-emerald-300">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Connected
                      </span>
                    ) : ch.status === "starting" || ch.status === "scan_qr" ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-border bg-secondary px-2.5 py-1 text-xs text-muted-foreground">
                        <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> Reconnecting…
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs text-amber-700 dark:text-amber-300">
                        <AlertTriangle className="h-3.5 w-3.5" /> {ch.status === "logged_out" ? "Signed out" : "Disconnected"}
                      </span>
                    )}
                    <span className="text-sm font-medium">{ch.displayName}</span>
                    {ch.phoneNumber && <span className="text-sm text-muted-foreground">{ch.phoneNumber}</span>}
                  </div>
                  {manage && (
                    <>
                      <WaWebChannelSettings
                        channelId={ch.id}
                        displayName={ch.displayName}
                        autoReplyAgentId={ch.autoReplyAgentId}
                        agents={agents}
                      />
                      <div className="flex flex-wrap items-start gap-2">
                        {ch.status !== "working" && ch.status !== "starting" && ch.status !== "scan_qr" && (
                          <WaWebRelink channelId={ch.id} />
                        )}
                        <form action={disconnectWaWebChannel.bind(null, ch.id)}>
                          <Button type="submit" variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10">
                            Unlink number
                          </Button>
                        </form>
                      </div>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}

          {manage &&
            (waWebReady ? (
              <WaWebConnect />
            ) : (
              <div className="rounded-lg border border-border p-3">
                <p className="text-xs text-muted-foreground">
                  Number linking isn&apos;t enabled on this server yet (admin: deploy the messaging gateway and set{" "}
                  <code>WA_WEB_GATEWAY_URL</code>, <code>WA_WEB_GATEWAY_API_KEY</code>, and{" "}
                  <code>WA_WEB_WEBHOOK_SECRET</code> — see <code>docs/wa-web-gateway-setup.md</code>).
                </p>
              </div>
            ))}

          <p className="text-xs text-muted-foreground">
            Linked numbers use WhatsApp&apos;s multi-device protocol. Keep messaging human-paced — bulk blasts can get a
            number restricted by WhatsApp — and open WhatsApp on your phone at least once every 14 days to stay linked.
          </p>
        </CardContent>
      </Card>

      {/* Meta */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Facebook &amp; Instagram (Meta)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {manage && (
            <div className="rounded-lg border border-border p-3">
              {metaOauth ? (
                <>
                  <a href="/api/oauth/meta">
                    <Button className="gap-2"><LogIn className="h-4 w-4" /> Connect with Facebook</Button>
                  </a>
                  <p className="mt-2 text-xs text-muted-foreground">
                    One click — log in and pick the Page(s) to connect. No developer setup needed.
                  </p>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">
                  One-click connect isn&apos;t enabled on this server yet (admin: set <code>META_APP_ID</code> and{" "}
                  <code>META_APP_SECRET</code>). You can still connect manually below.
                </p>
              )}
            </div>
          )}
          <details className="space-y-2">
            <summary className="cursor-pointer text-sm font-medium text-muted-foreground">Connect manually (advanced)</summary>
          <div className="mt-3 space-y-2 rounded-lg border border-border bg-secondary/40 p-3 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">Setup</p>
            <ol className="list-decimal space-y-1 pl-4">
              <li>In your Meta app (developers.facebook.com) add the <b>Messenger</b> and <b>Webhooks</b> products and (for IG) <b>Instagram</b>.</li>
              <li>Add this callback URL and verify token to the webhook, and subscribe to <b>messages</b>, <b>messaging_postbacks</b>, and <b>leadgen</b>:</li>
            </ol>
            <Copyable label="Callback URL" value={`${base}/api/meta/webhook`} />
            <Copyable label="Verify token" value={verifyToken} />
            <ol className="list-decimal space-y-1 pl-4" start={3}>
              <li>Generate a <b>Page access token</b>, subscribe the Page to your app, and paste the Page ID + token below. For IG DMs, add the linked Instagram account ID. For signature checks, set <code>META_APP_SECRET</code> in the server env.</li>
            </ol>
          </div>
          {manage ? (
            <MetaChannelForm
              agents={agents}
              defaults={meta ? { pageId: meta.externalId, igUserId: metaCfg.igUserId ?? null, pageName: metaCfg.pageName ?? null, autoReplyAgentId: meta.autoReplyAgentId, features: metaCfg.features } : undefined}
            />
          ) : (
            <p className="text-sm text-muted-foreground">Only owners and admins can connect channels.</p>
          )}
          </details>
          {meta && manage && (
            <form action={disconnectChannel.bind(null, meta.id)}>
              <Button type="submit" variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10">Disconnect Meta</Button>
            </form>
          )}
        </CardContent>
      </Card>

      {/* TikTok */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">TikTok</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {manage && (
            <div className="rounded-lg border border-border p-3">
              {tiktokOauth ? (
                <>
                  <a href="/api/oauth/tiktok">
                    <Button className="gap-2"><LogIn className="h-4 w-4" /> Connect with TikTok</Button>
                  </a>
                  <p className="mt-2 text-xs text-muted-foreground">
                    One click — authorize your advertiser account. No developer setup needed.
                  </p>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">
                  One-click connect isn&apos;t enabled on this server yet (admin: set <code>TIKTOK_APP_ID</code> and{" "}
                  <code>TIKTOK_APP_SECRET</code>). You can still connect manually below.
                </p>
              )}
            </div>
          )}
          <details className="space-y-2">
            <summary className="cursor-pointer text-sm font-medium text-muted-foreground">Connect manually (advanced)</summary>
          <div className="mt-3 space-y-2 rounded-lg border border-border bg-secondary/40 p-3 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">Setup</p>
            <ol className="list-decimal space-y-1 pl-4">
              <li>In TikTok for Business / Marketing API, create an app and authorize your advertiser account.</li>
              <li>Subscribe Lead Generation events to this endpoint:</li>
            </ol>
            <Copyable label="Callback URL" value={`${base}/api/tiktok/webhook`} />
            <ol className="list-decimal space-y-1 pl-4" start={3}>
              <li>Paste your Advertiser ID + access token below. New lead-form submissions create contacts automatically.</li>
            </ol>
            <p>Note: TikTok direct messaging isn&apos;t available via public API — this captures lead forms; DM ingestion turns on automatically if/when TikTok grants messaging access.</p>
          </div>
          {manage ? (
            <TikTokChannelForm defaults={tiktok ? { advertiserId: tiktok.externalId, advertiserName: ttCfg.advertiserName ?? null } : undefined} />
          ) : (
            <p className="text-sm text-muted-foreground">Only owners and admins can connect channels.</p>
          )}
          </details>
          {tiktok && manage && (
            <form action={disconnectChannel.bind(null, tiktok.id)}>
              <Button type="submit" variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10">Disconnect TikTok</Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
