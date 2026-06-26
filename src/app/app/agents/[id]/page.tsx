import Link from "next/link";
import { notFound } from "next/navigation";
import { MessageSquare, FileText } from "lucide-react";
import { requireAuth } from "@/lib/auth";
import { withTenant } from "@/lib/tenant";
import { updateAgent, deleteAgent } from "@/lib/actions/agents";
import { deleteDocument } from "@/lib/actions/knowledge";
import { PageHeader } from "@/components/app/page-header";
import { AgentForm } from "@/components/app/agent-form";
import { KnowledgeForm } from "@/components/app/knowledge-form";
import { DeleteButton } from "@/components/app/delete-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function AgentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireAuth();
  const data = await withTenant(ctx.workspaceId, async (tx) => {
    const agent = await tx.aiAgent.findFirst({ where: { id, deletedAt: null } });
    if (!agent) return null;
    const documents = await tx.agentDocument.findMany({
      where: { agentId: id },
      orderBy: { createdAt: "desc" },
      select: { id: true, title: true, createdAt: true },
    });
    return { agent, documents };
  });
  if (!data) notFound();
  const { agent, documents } = data;

  return (
    <div className="space-y-6">
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

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="h-4 w-4" /> Knowledge base
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div>
            <p className="mb-3 text-sm text-muted-foreground">
              Add documents the agent can answer from. Relevant snippets are retrieved per message
              (full-text search) and added to the agent&apos;s context.
            </p>
            <KnowledgeForm agentId={id} />
          </div>
          <div>
            <h4 className="mb-2 text-sm font-medium">Documents ({documents.length})</h4>
            {documents.length === 0 ? (
              <p className="text-sm text-muted-foreground">No documents yet.</p>
            ) : (
              <ul className="divide-y divide-border rounded-md border border-border">
                {documents.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-2 px-3 py-2">
                    <span className="truncate text-sm">{d.title}</span>
                    <DeleteButton
                      action={deleteDocument.bind(null, id, d.id)}
                      label=""
                      confirmText={`Delete "${d.title}"?`}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
