import Link from "next/link";
import { notFound } from "next/navigation";
import { MessageSquare } from "lucide-react";
import { requireAuth } from "@/lib/auth";
import { withTenant } from "@/lib/tenant";
import { updateAgent, deleteAgent } from "@/lib/actions/agents";
import { PageHeader } from "@/components/app/page-header";
import { AgentForm } from "@/components/app/agent-form";
import { DeleteButton } from "@/components/app/delete-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function AgentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireAuth();
  const agent = await withTenant(ctx.workspaceId, (tx) =>
    tx.aiAgent.findFirst({ where: { id, deletedAt: null } }),
  );
  if (!agent) notFound();

  return (
    <div>
      <PageHeader
        title={agent.name}
        description="Edit this agent's instructions and model."
        action={
          <div className="flex items-center gap-2">
            <Link href={`/app/agents/${id}/chat`}>
              <Button variant="outline" className="gap-2">
                <MessageSquare className="h-4 w-4" /> Chat
              </Button>
            </Link>
            <DeleteButton action={deleteAgent.bind(null, id)} label="Delete agent" />
          </div>
        }
      />
      <Card>
        <CardContent className="pt-6">
          <AgentForm
            action={updateAgent.bind(null, id)}
            defaults={{ name: agent.name, instructions: agent.instructions, model: agent.model }}
            submitLabel="Save changes"
          />
        </CardContent>
      </Card>
    </div>
  );
}
