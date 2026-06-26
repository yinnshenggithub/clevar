import { requireAuth, canManageWorkspace } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/app/page-header";
import { InviteForm } from "@/components/app/invite-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const ctx = await requireAuth();
  const canManage = canManageWorkspace(ctx.role);

  const [members, invites] = await Promise.all([
    prisma.workspaceMember.findMany({
      where: { workspaceId: ctx.workspaceId },
      include: { user: { select: { fullName: true, email: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.invitation.findMany({
      where: { workspaceId: ctx.workspaceId, acceptedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    }),
  ]);

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
