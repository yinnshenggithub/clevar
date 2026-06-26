import { requireAuth } from "@/lib/auth";
import { withTenant } from "@/lib/tenant";
import { createWorkflow } from "@/lib/actions/workflows";
import { PageHeader } from "@/components/app/page-header";
import { WorkflowCanvas } from "@/components/app/workflow-canvas";
import { Card, CardContent } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function NewWorkflowPage() {
  const ctx = await requireAuth();
  const agents = await withTenant(ctx.workspaceId, (tx) =>
    tx.aiAgent.findMany({ where: { deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  );

  return (
    <div>
      <PageHeader title="New workflow" description="Drag the canvas, click nodes to configure the trigger and actions." />
      <Card>
        <CardContent className="pt-6">
          <WorkflowCanvas action={createWorkflow} agents={agents} submitLabel="Create workflow" />
        </CardContent>
      </Card>
    </div>
  );
}
