import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireAuth, canManageWorkspace } from "@/lib/auth";
import { withTenant } from "@/lib/tenant";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/app/page-header";
import { ChannelForm } from "@/components/app/channel-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function InboxSettingsPage() {
  const ctx = await requireAuth();
  const [agents, channel] = await Promise.all([
    withTenant(ctx.workspaceId, (tx) =>
      tx.aiAgent.findMany({ where: { deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    ),
    prisma.whatsAppChannel.findFirst({ where: { workspaceId: ctx.workspaceId } }),
  ]);

  const base = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
  const webhookUrl = `${base}/api/whatsapp/webhook`;
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN || "(not set — add WHATSAPP_VERIFY_TOKEN env)";

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title="WhatsApp settings"
        description="Connect a WhatsApp Cloud API number to receive and send messages."
        action={
          <Link href="/app/inbox">
            <Button variant="ghost" className="gap-2">
              <ArrowLeft className="h-4 w-4" /> Inbox
            </Button>
          </Link>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">1 · Configure the webhook in Meta</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            In Meta → your app → WhatsApp → Configuration, set the callback URL and verify token, then
            subscribe to the <code>messages</code> field.
          </p>
          <div>
            <div className="text-xs font-medium text-muted-foreground">Callback URL</div>
            <code className="block break-all rounded bg-secondary px-2 py-1 text-xs">{webhookUrl}</code>
          </div>
          <div>
            <div className="text-xs font-medium text-muted-foreground">Verify token</div>
            <code className="block break-all rounded bg-secondary px-2 py-1 text-xs">{verifyToken}</code>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">2 · Connect your number</CardTitle>
        </CardHeader>
        <CardContent>
          {canManageWorkspace(ctx.role) ? (
            <ChannelForm
              agents={agents}
              defaults={
                channel
                  ? {
                      phoneNumberId: channel.phoneNumberId,
                      displayName: channel.displayName,
                      wabaId: channel.wabaId,
                      autoReplyAgentId: channel.autoReplyAgentId,
                    }
                  : undefined
              }
            />
          ) : (
            <p className="text-sm text-muted-foreground">Only owners and admins can connect channels.</p>
          )}
          {channel && (
            <p className="mt-3 text-xs text-muted-foreground">
              Connected: {channel.displayName} · phone number ID {channel.phoneNumberId}
              {channel.autoReplyAgentId ? " · auto-reply enabled" : ""}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
