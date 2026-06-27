import Link from "next/link";
import { Plus, Workflow as WorkflowIcon } from "lucide-react";
import { requireAuth } from "@/lib/auth";
import { withTenant } from "@/lib/tenant";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getTrigger, getActionMeta } from "@/lib/workflow/catalog";

export const dynamic = "force-dynamic";

const triggerLabel = (t: string) => getTrigger(t)?.label ?? t;
const actionLabel = (t: string) => getActionMeta(t)?.label ?? t;
const stepCount = (s: unknown) => (Array.isArray(s) ? s.length : 0);

export default async function WorkflowsPage() {
  const ctx = await requireAuth();
  const workflows = await withTenant(ctx.workspaceId, (tx) =>
    tx.workflow.findMany({ orderBy: { createdAt: "desc" } }),
  );

  return (
    <div>
      <PageHeader
        title="Workflows"
        description="Automate actions when something happens — e.g. a WhatsApp message arrives."
        action={
          <Link href="/app/workflows/new">
            <Button className="gap-2">
              <Plus className="h-4 w-4" /> New workflow
            </Button>
          </Link>
        }
      />

      {workflows.length === 0 ? (
        <Card className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <WorkflowIcon className="h-10 w-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No workflows yet.</p>
          <Link href="/app/workflows/new">
            <Button className="gap-2">
              <Plus className="h-4 w-4" /> Create your first workflow
            </Button>
          </Link>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-secondary/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">When</th>
                <th className="px-4 py-3 font-medium">Then</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {workflows.map((w) => (
                <tr key={w.id} className="hover:bg-accent/40">
                  <td className="px-4 py-3">
                    <Link href={`/app/workflows/${w.id}`} className="font-medium hover:underline">
                      {w.name}
                    </Link>
                    {w.conditionField && (
                      <div className="text-xs text-muted-foreground">
                        if {w.conditionField} {w.conditionOp} “{w.conditionValue}”
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{triggerLabel(w.triggerType)}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {actionLabel(w.actionType)}
                    {stepCount(w.steps) > 1 && <span className="text-xs"> +{stepCount(w.steps) - 1} more</span>}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={w.enabled ? "success" : "secondary"}>{w.enabled ? "Active" : "Off"}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
