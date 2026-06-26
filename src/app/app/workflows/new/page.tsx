import { requireAuth } from "@/lib/auth";
import { withTenant } from "@/lib/tenant";
import { createWorkflow } from "@/lib/actions/workflows";
import { PageHeader } from "@/components/app/page-header";
import { WorkflowForm } from "@/components/app/workflow-form";
import { Card, CardContent } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function NewWorkflowPage() {
  const ctx = await requireAuth();
  const agents = await withTenant(ctx.workspaceId, (tx) =>
    tx.aiAgent.findMany({ where: { deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  );

  return (
    <div>
      <PageHeader title="New workflow" description="Pick a trigger, an optional condition, and an action." />
      <Card>
        <CardContent className="pt-6">
          <WorkflowForm action={createWorkflow} agents={agents} submitLabel="Create workflow" />
        </CardContent>
      </Card>
    </div>
  );
}
