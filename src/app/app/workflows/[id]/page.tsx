import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { withTenant } from "@/lib/tenant";
import { prisma } from "@/lib/prisma";
import { updateWorkflow, deleteWorkflow } from "@/lib/actions/workflows";
import { PageHeader } from "@/components/app/page-header";
import { WorkflowCanvas, type CanvasStep } from "@/components/app/workflow-canvas";
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
    const [agents, pipelines, stages] = await Promise.all([
      tx.aiAgent.findMany({ where: { deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
      tx.pipeline.findMany({ select: { id: true, name: true }, orderBy: { position: "asc" } }),
      tx.stage.findMany({ select: { id: true, name: true, pipelineId: true }, orderBy: { position: "asc" } }),
    ]);
    return { workflow, agents, pipelines, stages };
  });

  if (!data) notFound();
  const { workflow, agents, pipelines, stages } = data;
  const members = await prisma.workspaceMember.findMany({
    where: { workspaceId: ctx.workspaceId },
    include: { user: { select: { fullName: true, email: true } } },
  });
  const memberOpts = members.map((m) => ({ id: m.userId, name: m.user.fullName || m.user.email }));

  const steps: CanvasStep[] =
    Array.isArray(workflow.steps) && workflow.steps.length > 0
      ? (workflow.steps as unknown as CanvasStep[])
      : [{ type: workflow.actionType, config: { agentId: workflow.actionAgentId ?? "", text: workflow.actionText ?? "" } }];

  return (
    <div>
      <PageHeader
        title={workflow.name}
        description="Edit this automation."
        action={<DeleteButton action={deleteWorkflow.bind(null, id)} label="Delete workflow" />}
      />
      <Card>
        <CardContent className="pt-6">
          <WorkflowCanvas
            action={updateWorkflow.bind(null, id)}
            refData={{ agents, pipelines, stages, members: memberOpts }}
            defaults={{
              name: workflow.name,
              enabled: workflow.enabled,
              triggerType: workflow.triggerType,
              conditionField: workflow.conditionField,
              conditionOp: workflow.conditionOp,
              conditionValue: workflow.conditionValue,
              steps,
            }}
            submitLabel="Save changes"
          />
        </CardContent>
      </Card>
    </div>
  );
}
