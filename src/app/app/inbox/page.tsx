import Link from "next/link";
import { Settings, MessageSquare, ArrowLeft } from "lucide-react";
import { requireAuth } from "@/lib/auth";
import { withTenant } from "@/lib/tenant";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/app/page-header";
import { SearchBar } from "@/components/app/search-bar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ReplyForm } from "@/components/app/reply-form";
import { AssignAgentSelect } from "@/components/app/assign-agent-select";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string; q?: string }>;
}) {
  const { c, q } = await searchParams;
  const query = (q ?? "").trim();
  const ctx = await requireAuth();

  const [data, agents, channel] = await Promise.all([
    withTenant(ctx.workspaceId, async (tx) => {
      const convos = await tx.conversation.findMany({
        where: query
          ? {
              OR: [
                { customerName: { contains: query, mode: "insensitive" } },
                { customerPhone: { contains: query, mode: "insensitive" } },
              ],
            }
          : {},
        orderBy: { lastMessageAt: "desc" },
        take: 100,
      });
      const activeId = c && convos.some((x) => x.id === c) ? c : convos[0]?.id;
      const active = convos.find((x) => x.id === activeId) ?? null;
      const messages = activeId
        ? await tx.message.findMany({ where: { conversationId: activeId }, orderBy: { createdAt: "asc" }, take: 200 })
        : [];
      return { convos, active, messages };
    }),
    withTenant(ctx.workspaceId, (tx) =>
      tx.aiAgent.findMany({ where: { deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    ),
    prisma.whatsAppChannel.findFirst({ where: { workspaceId: ctx.workspaceId } }),
  ]);

  const settingsBtn = (
    <Link href="/app/inbox/settings">
      <Button variant="outline" className="gap-2">
        <Settings className="h-4 w-4" /> Settings
      </Button>
    </Link>
  );

  if (!channel) {
    return (
      <div>
        <PageHeader title="Inbox" description="WhatsApp conversations." action={settingsBtn} />
        <Card className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <MessageSquare className="h-10 w-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No WhatsApp channel connected yet.</p>
          <Link href="/app/inbox/settings">
            <Button>Connect WhatsApp</Button>
          </Link>
        </Card>
      </div>
    );
  }

  const showThread = Boolean(data.active);

  return (
    <div>
      <PageHeader title="Inbox" description={channel.displayName} action={settingsBtn} />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-[300px_1fr]">
        {/* Conversation list */}
        <Card className={cn("overflow-hidden", showThread && c ? "hidden md:block" : "block")}>
          <div className="p-3 pb-0">
            <SearchBar placeholder="Search conversations…" defaultValue={query} />
          </div>
          {data.convos.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              {query ? "No conversations match your search." : "No conversations yet. Messages to your number will appear here."}
            </p>
          ) : (
            <ul className="max-h-[calc(100vh-12rem)] divide-y divide-border overflow-y-auto">
              {data.convos.map((cv) => (
                <li key={cv.id}>
                  <Link
                    href={`/app/inbox?c=${cv.id}`}
                    className={cn(
                      "block px-4 py-3 hover:bg-accent/50",
                      data.active?.id === cv.id && "bg-accent/60",
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{cv.customerName || cv.customerPhone}</span>
                      {cv.status === "CLOSED" && <span className="text-xs text-muted-foreground">closed</span>}
                    </div>
                    <div className="text-xs text-muted-foreground">{cv.customerPhone}</div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Thread */}
        <Card className={cn("flex flex-col", showThread ? "block" : "hidden md:flex")}>
          {data.active ? (
            <>
              <div className="flex items-center justify-between gap-2 border-b border-border p-3">
                <div className="flex items-center gap-2">
                  <Link href="/app/inbox" className="md:hidden">
                    <Button variant="ghost" size="icon" aria-label="Back">
                      <ArrowLeft className="h-4 w-4" />
                    </Button>
                  </Link>
                  <div>
                    <div className="font-medium">{data.active.customerName || data.active.customerPhone}</div>
                    <div className="text-xs text-muted-foreground">{data.active.customerPhone}</div>
                  </div>
                </div>
                <AssignAgentSelect
                  conversationId={data.active.id}
                  agents={agents}
                  current={data.active.assignedAgentId}
                />
              </div>

              <div className="flex-1 space-y-3 overflow-y-auto p-4" style={{ maxHeight: "calc(100vh - 20rem)" }}>
                {data.messages.map((m) => (
                  <div key={m.id} className={cn("flex", m.direction === "OUTBOUND" ? "justify-end" : "justify-start")}>
                    <div
                      className={cn(
                        "max-w-[80%] whitespace-pre-wrap rounded-2xl px-4 py-2 text-sm",
                        m.direction === "OUTBOUND"
                          ? "bg-primary text-primary-foreground"
                          : "bg-secondary text-secondary-foreground",
                      )}
                    >
                      {m.body}
                    </div>
                  </div>
                ))}
                {data.messages.length === 0 && (
                  <p className="text-center text-sm text-muted-foreground">No messages yet.</p>
                )}
              </div>

              <ReplyForm conversationId={data.active.id} />
            </>
          ) : (
            <p className="p-6 text-center text-sm text-muted-foreground">Select a conversation.</p>
          )}
        </Card>
      </div>
    </div>
  );
}
