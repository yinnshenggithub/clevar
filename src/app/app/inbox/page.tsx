import Link from "next/link";
import { Settings, MessageSquare, ArrowLeft } from "lucide-react";
import type { Prisma, ConversationStatus } from "@prisma/client";
import { requireAuth } from "@/lib/auth";
import { withTenant } from "@/lib/tenant";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/app/page-header";
import { SearchBar } from "@/components/app/search-bar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ReplyForm } from "@/components/app/reply-form";
import { AssignAgentSelect } from "@/components/app/assign-agent-select";
import { ConversationControls, PriorityDot, StatusTag } from "@/components/app/conversation-controls";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const TABS: { key: string; label: string; status?: ConversationStatus }[] = [
  { key: "all", label: "All" },
  { key: "open", label: "Open", status: "OPEN" },
  { key: "pending", label: "Pending", status: "PENDING" },
  { key: "snoozed", label: "Snoozed", status: "SNOOZED" },
  { key: "resolved", label: "Resolved", status: "RESOLVED" },
];

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string; q?: string; s?: string }>;
}) {
  const { c, q, s } = await searchParams;
  const query = (q ?? "").trim();
  const tab = TABS.find((t) => t.key === (s ?? "all")) ?? TABS[0];
  const ctx = await requireAuth();

  const [data, agents, members, channel] = await Promise.all([
    withTenant(ctx.workspaceId, async (tx) => {
      const where: Prisma.ConversationWhereInput = {
        ...(tab.status ? { status: tab.status } : {}),
        ...(query
          ? {
              OR: [
                { customerName: { contains: query, mode: "insensitive" } },
                { customerPhone: { contains: query, mode: "insensitive" } },
              ],
            }
          : {}),
      };
      const convos = await tx.conversation.findMany({ where, orderBy: { lastMessageAt: "desc" }, take: 100 });
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
    prisma.workspaceMember.findMany({
      where: { workspaceId: ctx.workspaceId },
      include: { user: { select: { id: true, fullName: true } } },
    }),
    prisma.whatsAppChannel.findFirst({ where: { workspaceId: ctx.workspaceId } }),
  ]);

  const memberList = members.map((m) => ({ id: m.user.id, name: m.user.fullName }));
  const memberNameById = new Map(memberList.map((m) => [m.id, m.name]));

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
  const tabHref = (key: string) => {
    const p = new URLSearchParams();
    if (key !== "all") p.set("s", key);
    if (query) p.set("q", query);
    return `/app/inbox${p.toString() ? `?${p}` : ""}`;
  };

  return (
    <div>
      <PageHeader title="Inbox" description={channel.displayName} action={settingsBtn} />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-[300px_1fr]">
        {/* Conversation list */}
        <Card className={cn("overflow-hidden", showThread && c ? "hidden md:block" : "block")}>
          <div className="p-3 pb-2">
            <SearchBar placeholder="Search conversations…" defaultValue={query} />
            <div className="mt-2 flex flex-wrap gap-1">
              {TABS.map((t) => (
                <Link
                  key={t.key}
                  href={tabHref(t.key)}
                  className={cn(
                    "rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
                    tab.key === t.key
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                  )}
                >
                  {t.label}
                </Link>
              ))}
            </div>
          </div>
          {data.convos.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              {query ? "No conversations match your search." : "No conversations here yet."}
            </p>
          ) : (
            <ul className="max-h-[calc(100vh-15rem)] divide-y divide-border overflow-y-auto">
              {data.convos.map((cv) => (
                <li key={cv.id}>
                  <Link
                    href={`/app/inbox?c=${cv.id}${tab.key !== "all" ? `&s=${tab.key}` : ""}`}
                    className={cn("block px-4 py-3 hover:bg-accent/50", data.active?.id === cv.id && "bg-accent/60")}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium">{cv.customerName || cv.customerPhone}</span>
                      <div className="flex shrink-0 items-center gap-1">
                        <PriorityDot priority={cv.priority} />
                        <StatusTag status={cv.status} />
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{cv.customerPhone}</span>
                      {cv.assignedUserId && memberNameById.has(cv.assignedUserId) && (
                        <span className="truncate">{memberNameById.get(cv.assignedUserId)}</span>
                      )}
                    </div>
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
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border p-3">
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
                <div className="flex flex-wrap items-center gap-1.5">
                  <ConversationControls
                    conversationId={data.active.id}
                    status={data.active.status}
                    priority={data.active.priority}
                    assignedUserId={data.active.assignedUserId}
                    members={memberList}
                  />
                  <AssignAgentSelect
                    conversationId={data.active.id}
                    agents={agents}
                    current={data.active.assignedAgentId}
                  />
                </div>
              </div>

              <div className="flex-1 space-y-3 overflow-y-auto p-4" style={{ maxHeight: "calc(100vh - 20rem)" }}>
                {data.messages.map((m) => {
                  const src = m.mediaId ? `/api/whatsapp/media/${m.mediaId}` : null;
                  if (m.private) {
                    return (
                      <div key={m.id} className="flex justify-center">
                        <div className="max-w-[85%] rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm">
                          <div className="mb-0.5 text-[10px] font-semibold uppercase text-amber-600 dark:text-amber-400">
                            Internal note{m.authorUserId && memberNameById.has(m.authorUserId) ? ` · ${memberNameById.get(m.authorUserId)}` : ""}
                          </div>
                          <div className="whitespace-pre-wrap">{m.body}</div>
                        </div>
                      </div>
                    );
                  }
                  return (
                    <div key={m.id} className={cn("flex", m.direction === "OUTBOUND" ? "justify-end" : "justify-start")}>
                      <div
                        className={cn(
                          "max-w-[80%] space-y-1 whitespace-pre-wrap rounded-2xl px-4 py-2 text-sm",
                          m.direction === "OUTBOUND"
                            ? "bg-primary text-primary-foreground"
                            : "bg-secondary text-secondary-foreground",
                        )}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {src && m.type === "image" && <img src={src} alt="attachment" className="max-h-64 rounded-lg" />}
                        {src && m.type === "video" && <video controls src={src} className="max-h-64 rounded-lg" />}
                        {src && m.type === "audio" && <audio controls src={src} className="w-56" />}
                        {src && m.type === "document" && (
                          <a href={src} target="_blank" rel="noreferrer" className="flex items-center gap-1 underline">
                            📄 {m.mediaFilename || "Document"}
                          </a>
                        )}
                        {m.body && <div>{m.body}</div>}
                      </div>
                    </div>
                  );
                })}
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
