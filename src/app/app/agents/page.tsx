import Link from "next/link";
import { Plus, Bot, MessageSquare } from "lucide-react";
import { requireAuth } from "@/lib/auth";
import { withTenant } from "@/lib/tenant";
import { getCredits } from "@/lib/credits";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

export default async function AgentsPage() {
  const ctx = await requireAuth();
  const [agents, credits] = await Promise.all([
    withTenant(ctx.workspaceId, (tx) =>
      tx.aiAgent.findMany({ where: { deletedAt: null }, orderBy: { createdAt: "desc" } }),
    ),
    getCredits(ctx.workspaceId),
  ]);

  return (
    <div>
      <PageHeader
        title="AI Agents"
        description="Create assistants with their own instructions, then chat with them."
        action={
          <div className="flex items-center gap-3">
            <Badge variant="secondary">
              {credits.remaining}/{credits.limit} credits left
            </Badge>
            <Link href="/app/agents/new">
              <Button className="gap-2">
                <Plus className="h-4 w-4" /> New agent
              </Button>
            </Link>
          </div>
        }
      />

      {agents.length === 0 ? (
        <Card className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <Bot className="h-10 w-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No agents yet.</p>
          <Link href="/app/agents/new">
            <Button className="gap-2">
              <Plus className="h-4 w-4" /> Create your first agent
            </Button>
          </Link>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {agents.map((a) => (
            <Card key={a.id} className="flex flex-col">
              <CardContent className="flex flex-1 flex-col pt-6">
                <div className="flex items-center gap-2">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Bot className="h-5 w-5" />
                  </span>
                  <Link href={`/app/agents/${a.id}`} className="font-semibold hover:underline">
                    {a.name}
                  </Link>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Badge variant="secondary" className="capitalize">{a.mode}</Badge>
                  <Badge variant="secondary" className="capitalize">{a.tone}</Badge>
                  {a.handoffEnabled && <Badge variant="secondary">handoff</Badge>}
                </div>
                <p className="mt-3 line-clamp-3 flex-1 text-sm text-muted-foreground">
                  {a.objectives || a.instructions || "No objectives set yet."}
                </p>
                <div className="mt-4 flex items-center gap-2">
                  <Link href={`/app/agents/${a.id}/chat`} className="flex-1">
                    <Button variant="default" className="w-full gap-2">
                      <MessageSquare className="h-4 w-4" /> Chat
                    </Button>
                  </Link>
                  <Link href={`/app/agents/${a.id}`}>
                    <Button variant="outline">Edit</Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
