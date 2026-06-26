import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createAgent } from "@/lib/actions/agents";
import { PageHeader } from "@/components/app/page-header";
import { AgentForm } from "@/components/app/agent-form";
import { Card, CardContent } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function NewAgentPage() {
  const ctx = await requireAuth();
  const members = await prisma.workspaceMember.findMany({
    where: { workspaceId: ctx.workspaceId },
    include: { user: { select: { id: true, fullName: true } } },
  });
  const memberList = members.map((m) => ({ id: m.user.id, name: m.user.fullName }));

  return (
    <div>
      <PageHeader title="New AI agent" description="Tune the persona, objectives, rules, and handoff." />
      <Card>
        <CardContent className="pt-6">
          <AgentForm action={createAgent} members={memberList} submitLabel="Create agent" />
        </CardContent>
      </Card>
    </div>
  );
}
