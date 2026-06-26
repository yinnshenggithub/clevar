import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { withTenant } from "@/lib/tenant";
import { updateWorkflow, deleteWorkflow } from "@/lib/actions/workflows";
import { PageHeader } from "@/components/app/page-header";
import { WorkflowForm } from "@/components/app/workflow-form";
import { DeleteButton } from "@/components/app/delete-button";
import { Card, CardContent } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function WorkflowDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireAuth();

  const data = await withTenant(ctx.workspaceId, async (tx) => {
    const workflow = await tx.workflow.findFirst({ where: { id } });
    if (!workflow) return null;
    const agents = await tx.aiAgent.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    return { workflow, agents };
  });

  if (!data) notFound();
  const { workflow, agents } = data;

  return (
    <div>
      <PageHeader
        title={workflow.name}
        description="Edit this automation."
        action={<DeleteButton action={deleteWorkflow.bind(null, id)} label="Delete workflow" />}
      />
      <Card>
        <CardContent className="pt-6">
          <WorkflowForm
            action={updateWorkflow.bind(null, id)}
            agents={agents}
            defaults={{
              name: workflow.name,
              enabled: workflow.enabled,
              triggerType: workflow.triggerType,
              conditionField: workflow.conditionField,
              conditionOp: workflow.conditionOp,
              conditionValue: workflow.conditionValue,
              actionType: workflow.actionType,
              actionAgentId: workflow.actionAgentId,
              actionText: workflow.actionText,
            }}
            submitLabel="Save changes"
          />
        </CardContent>
      </Card>
    </div>
  );
}
