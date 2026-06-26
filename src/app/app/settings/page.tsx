import { requireAuth, canManageWorkspace } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { withTenant } from "@/lib/tenant";
import { getCredits } from "@/lib/credits";
import { PLAN_LABELS } from "@/lib/plans";
import { PageHeader } from "@/components/app/page-header";
import { InviteForm } from "@/components/app/invite-form";
import { PlanForm } from "@/components/app/plan-form";
import { ApiKeyManager } from "@/components/app/api-key-manager";
import { WebhookManager } from "@/components/app/webhook-manager";
import { WEBHOOK_EVENTS } from "@/lib/webhooks";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const ctx = await requireAuth();
  const canManage = canManageWorkspace(ctx.role);
  const isOwner = ctx.role === "OWNER";

  const [members, invites, credits, ws, usage, apiKeys, webhooks] = await Promise.all([
    prisma.workspaceMember.findMany({
      where: { workspaceId: ctx.workspaceId },
      include: { user: { select: { fullName: true, email: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.invitation.findMany({
      where: { workspaceId: ctx.workspaceId, acceptedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    }),
    getCredits(ctx.workspaceId),
    prisma.workspace.findUnique({ where: { id: ctx.workspaceId }, select: { plan: true } }),
    withTenant(ctx.workspaceId, (tx) =>
      tx.aiUsage.findMany({ orderBy: { createdAt: "desc" }, take: 8 }),
    ),
    prisma.apiKey.findMany({ where: { workspaceId: ctx.workspaceId }, orderBy: { createdAt: "desc" } }),
    prisma.webhook.findMany({ where: { workspaceId: ctx.workspaceId }, orderBy: { createdAt: "desc" } }),
  ]);

  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");

  const plan = ws?.plan ?? "FREE";
  const resetAt = new Date(credits.periodStart.getTime() + 30 * 24 * 60 * 60 * 1000);
  const usedPct = credits.limit > 0 ? Math.min(100, Math.round((credits.used / credits.limit) * 100)) : 0;

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader title="Settings" description="Manage your workspace and team." />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Workspace</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <div>
            <span className="text-muted-foreground">Name: </span>
            {ctx.workspace.name}
          </div>
          <div>
            <span className="text-muted-foreground">Slug: </span>
            {ctx.workspace.slug}
          </div>
          <div>
            <span className="text-muted-foreground">Your role: </span>
            <Badge variant="secondary">{ctx.role}</Badge>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Plan &amp; usage</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Current plan:</span>
            <Badge>{PLAN_LABELS[plan]}</Badge>
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
              <span>AI credits this period</span>
              <span>
                {credits.used.toLocaleString()} / {credits.limit.toLocaleString()}
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
              <div className="h-full bg-primary" style={{ width: `${usedPct}%` }} />
            </div>
            <div className="mt-1 text-xs text-muted-foreground">Resets {resetAt.toLocaleDateString()}</div>
          </div>
          {isOwner ? (
            <PlanForm current={plan} />
          ) : (
            <p className="text-xs text-muted-foreground">Only the owner can change the plan.</p>
          )}
          {usage.length > 0 && (
            <div>
              <h4 className="mb-1 font-medium">Recent AI usage</h4>
              <ul className="divide-y divide-border text-xs text-muted-foreground">
                {usage.map((u) => (
                  <li key={u.id} className="flex items-center justify-between py-1.5">
                    <span>{u.createdAt.toLocaleString()}</span>
                    <span>
                      {u.credits} credit{u.credits === 1 ? "" : "s"} · {u.tokensIn + u.tokensOut} tokens
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Members ({members.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-y divide-border">
            {members.map((m) => (
              <li key={m.id} className="flex items-center justify-between py-2.5">
                <div>
                  <div className="text-sm font-medium">{m.user.fullName}</div>
                  <div className="text-xs text-muted-foreground">{m.user.email}</div>
                </div>
                <Badge variant={m.role === "OWNER" ? "default" : "secondary"}>{m.role}</Badge>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Invite a teammate</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <InviteForm />
            {invites.length > 0 && (
              <div>
                <h4 className="mb-2 text-sm font-medium">Pending invitations</h4>
                <ul className="divide-y divide-border">
                  {invites.map((i) => (
                    <li key={i.id} className="flex items-center justify-between py-2 text-sm">
                      <span>{i.email}</span>
                      <Badge variant="secondary">{i.role}</Badge>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Developer API</CardTitle>
          </CardHeader>
          <CardContent>
            <ApiKeyManager
              baseUrl={baseUrl}
              keys={apiKeys.map((k) => ({
                id: k.id,
                name: k.name,
                prefix: k.prefix,
                lastUsedAt: k.lastUsedAt ? k.lastUsedAt.toISOString() : null,
                revokedAt: k.revokedAt ? k.revokedAt.toISOString() : null,
              }))}
            />
          </CardContent>
        </Card>
      )}

      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Webhooks</CardTitle>
          </CardHeader>
          <CardContent>
            <WebhookManager events={WEBHOOK_EVENTS} hooks={webhooks.map((h) => ({ id: h.id, url: h.url, events: h.events }))} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your profile</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <div>
            <span className="text-muted-foreground">Name: </span>
            {ctx.user.fullName}
          </div>
          <div>
            <span className="text-muted-foreground">Email: </span>
            {ctx.user.email}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
