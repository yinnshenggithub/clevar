import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireAuth, canManageWorkspace } from "@/lib/auth";
import { withTenant } from "@/lib/tenant";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/app/page-header";
import { WidgetForm } from "@/components/app/widget-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function WidgetSettingsPage() {
  const ctx = await requireAuth();
  const [widget, agents] = await Promise.all([
    prisma.webWidget.findFirst({ where: { workspaceId: ctx.workspaceId } }),
    withTenant(ctx.workspaceId, (tx) =>
      tx.aiAgent.findMany({ where: { deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    ),
  ]);

  const base = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
  const snippet = widget ? `<script src="${base}/api/widget/${widget.publicKey}/loader" async></script>` : null;

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title="Website chat widget"
        description="Add a live-chat bubble to any website — messages land in this inbox."
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
          <CardTitle className="text-base">Appearance &amp; behavior</CardTitle>
        </CardHeader>
        <CardContent>
          {canManageWorkspace(ctx.role) ? (
            <WidgetForm
              agents={agents}
              defaults={
                widget
                  ? {
                      name: widget.name,
                      color: widget.color,
                      welcomeMessage: widget.welcomeMessage,
                      autoReplyAgentId: widget.autoReplyAgentId,
                      enabled: widget.enabled,
                    }
                  : undefined
              }
            />
          ) : (
            <p className="text-sm text-muted-foreground">Only owners and admins can configure the widget.</p>
          )}
        </CardContent>
      </Card>

      {snippet && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Install on your website</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>Paste this snippet just before the closing <code>&lt;/body&gt;</code> tag on any page:</p>
            <code className="block break-all rounded-md border border-border bg-secondary px-3 py-2 text-xs text-foreground">
              {snippet}
            </code>
            <p>
              Try it now:{" "}
              <Link href={`/widget/${widget!.publicKey}`} target="_blank" className="text-primary underline">
                open the chat preview
              </Link>
              .
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
