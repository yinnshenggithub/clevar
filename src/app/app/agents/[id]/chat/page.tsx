import Link from "next/link";
import { notFound } from "next/navigation";
import type { Message } from "ai/react";
import { ArrowLeft, Plus } from "lucide-react";
import { requireAuth } from "@/lib/auth";
import { withTenant } from "@/lib/tenant";
import { newConversation } from "@/lib/actions/agents";
import { getCredits } from "@/lib/credits";
import { ChatBox } from "@/components/app/chat-box";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

export default async function AgentChatPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ c?: string }>;
}) {
  const { id } = await params;
  const { c } = await searchParams;
  const ctx = await requireAuth();

  const data = await withTenant(ctx.workspaceId, async (tx) => {
    const agent = await tx.aiAgent.findFirst({ where: { id, deletedAt: null } });
    if (!agent) return null;
    let convo =
      (c ? await tx.aiConversation.findFirst({ where: { id: c, agentId: id } }) : null) ??
      (await tx.aiConversation.findFirst({ where: { agentId: id }, orderBy: { updatedAt: "desc" } }));
    if (!convo) {
      convo = await tx.aiConversation.create({ data: { workspaceId: ctx.workspaceId, agentId: id } });
    }
    const msgs = await tx.aiMessage.findMany({
      where: { conversationId: convo.id },
      orderBy: { createdAt: "asc" },
    });
    return { agent, convo, msgs };
  });

  if (!data) notFound();
  const credits = await getCredits(ctx.workspaceId);

  const initialMessages: Message[] = data.msgs.map((m) => ({
    id: m.id,
    role: m.role === "USER" ? "user" : "assistant",
    content: m.content,
  }));

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href={`/app/agents/${id}`}>
            <Button variant="ghost" size="icon" aria-label="Back">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-xl font-bold tracking-tight">{data.agent.name}</h1>
            <p className="text-xs text-muted-foreground">{data.agent.model}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant="secondary">{credits.remaining}/{credits.limit} credits</Badge>
          <form action={newConversation.bind(null, id)}>
            <Button type="submit" variant="outline" className="gap-2">
              <Plus className="h-4 w-4" /> New chat
            </Button>
          </form>
        </div>
      </div>

      <ChatBox agentId={id} conversationId={data.convo.id} initialMessages={initialMessages} />
    </div>
  );
}
