import Link from "next/link";
import { ArrowLeft, Zap } from "lucide-react";
import { requireAuth } from "@/lib/auth";
import { withTenant } from "@/lib/tenant";
import { prisma } from "@/lib/prisma";
import { deleteMacro, type MacroAction } from "@/lib/actions/macros";
import { PageHeader } from "@/components/app/page-header";
import { MacroForm } from "@/components/app/macro-form";
import { DeleteButton } from "@/components/app/delete-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

const ACTION_SUMMARY: Record<string, string> = {
  send_reply: "Reply",
  add_note: "Note",
  add_label: "Label",
  set_status: "Status",
  set_priority: "Priority",
  assign_user: "Assign",
};

export default async function MacrosPage() {
  const ctx = await requireAuth();
  const [macros, labels, members] = await Promise.all([
    withTenant(ctx.workspaceId, (tx) => tx.macro.findMany({ orderBy: { name: "asc" } })),
    withTenant(ctx.workspaceId, (tx) => tx.label.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } })),
    prisma.workspaceMember.findMany({
      where: { workspaceId: ctx.workspaceId },
      include: { user: { select: { id: true, fullName: true } } },
    }),
  ]);
  const memberList = members.map((m) => ({ id: m.user.id, name: m.user.fullName }));

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title="Macros"
        description="One-click action bundles for conversations — reply, label, assign, resolve, all at once."
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
          <CardTitle className="text-base">New macro</CardTitle>
        </CardHeader>
        <CardContent>
          <MacroForm labels={labels} members={memberList} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your macros ({macros.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {macros.length === 0 ? (
            <p className="text-sm text-muted-foreground">No macros yet.</p>
          ) : (
            macros.map((m) => {
              const actions = (Array.isArray(m.actions) ? m.actions : []) as unknown as MacroAction[];
              return (
                <div key={m.id} className="flex items-start justify-between gap-3 rounded-lg border border-border p-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 font-medium">
                      <Zap className="h-4 w-4 text-primary" /> {m.name}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {actions.map((a, i) => (
                        <span key={i} className="rounded bg-secondary px-1.5 py-0.5 text-xs text-muted-foreground">
                          {ACTION_SUMMARY[a.type] ?? a.type}
                        </span>
                      ))}
                    </div>
                  </div>
                  <DeleteButton action={deleteMacro.bind(null, m.id)} label="" confirmText={`Delete macro "${m.name}"?`} />
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}
