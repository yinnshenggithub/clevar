import { requireAuth } from "@/lib/auth";
import { withTenant } from "@/lib/tenant";
import { prisma } from "@/lib/prisma";
import { createWorkflow } from "@/lib/actions/workflows";
import { PageHeader } from "@/components/app/page-header";
import { WorkflowCanvas } from "@/components/app/workflow-canvas";
import { Card, CardContent } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function NewWorkflowPage() {
  const ctx = await requireAuth();
  const [refData, members] = await Promise.all([
    withTenant(ctx.workspaceId, async (tx) => {
      const [agents, pipelines, stages] = await Promise.all([
        tx.aiAgent.findMany({ where: { deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
        tx.pipeline.findMany({ select: { id: true, name: true }, orderBy: { position: "asc" } }),
        tx.stage.findMany({ select: { id: true, name: true, pipelineId: true }, orderBy: { position: "asc" } }),
      ]);
      return { agents, pipelines, stages };
    }),
    prisma.workspaceMember.findMany({
      where: { workspaceId: ctx.workspaceId },
      include: { user: { select: { fullName: true, email: true } } },
    }),
  ]);
  const memberOpts = members.map((m) => ({ id: m.userId, name: m.user.fullName || m.user.email }));

  return (
    <div>
      <PageHeader title="New workflow" description="Pick a trigger, then chain actions. Click a node to configure it." />
      <Card>
        <CardContent className="pt-6">
          <WorkflowCanvas action={createWorkflow} refData={{ ...refData, members: memberOpts }} submitLabel="Create workflow" />
        </CardContent>
      </Card>
    </div>
  );
}
