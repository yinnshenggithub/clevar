import Link from "next/link";
import { ArrowLeft, CheckCircle2 } from "lucide-react";
import { requireAuth, canManageWorkspace } from "@/lib/auth";
import { withTenant } from "@/lib/tenant";
import { prisma } from "@/lib/prisma";
import { disconnectChannel } from "@/lib/actions/channels";
import { PageHeader } from "@/components/app/page-header";
import { MetaChannelForm, TikTokChannelForm } from "@/components/app/channel-forms";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

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
export default async function ChannelsPage() {
  const ctx = await requireAuth();
  const manage = canManageWorkspace(ctx.role);
  const [agents, meta, tiktok] = await Promise.all([
    withTenant(ctx.workspaceId, (tx) => tx.aiAgent.findMany({ where: { deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } })),
    prisma.channelConnection.findFirst({ where: { workspaceId: ctx.workspaceId, provider: "meta" } }),
    prisma.channelConnection.findFirst({ where: { workspaceId: ctx.workspaceId, provider: "tiktok" } }),
  ]);

  const base = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
  const verifyToken = process.env.META_VERIFY_TOKEN || process.env.WHATSAPP_VERIFY_TOKEN || "(set META_VERIFY_TOKEN)";
  const metaCfg = (meta?.config ?? {}) as any;
  const ttCfg = (tiktok?.config ?? {}) as any;

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title="Channels: Meta &amp; TikTok"
        description="Connect Facebook Messenger, Instagram DMs, and Lead Ads, plus TikTok lead forms."
        action={
          <Link href="/app/inbox">
            <Button variant="ghost" className="gap-2"><ArrowLeft className="h-4 w-4" /> Inbox</Button>
          </Link>
        }
      />

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

      {/* Meta */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Facebook &amp; Instagram (Meta)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2 rounded-lg border border-border bg-secondary/40 p-3 text-xs text-muted-foreground">
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
          <div className="space-y-2 rounded-lg border border-border bg-secondary/40 p-3 text-xs text-muted-foreground">
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
