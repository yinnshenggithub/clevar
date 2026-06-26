import Link from "next/link";
import type { ReactNode } from "react";
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
import { ConversationLabels, LabelDots } from "@/components/app/conversation-labels";
import { MacroRunner } from "@/components/app/macro-runner";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const TABS: { key: string; label: string; status?: ConversationStatus }[] = [
  { key: "all", label: "All" },
  { key: "open", label: "Open", status: "OPEN" },
  { key: "pending", label: "Pending", status: "PENDING" },
  { key: "snoozed", label: "Snoozed", status: "SNOOZED" },
  { key: "resolved", label: "Resolved", status: "RESOLVED" },
];

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-2">
      <dt className="truncate text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words font-medium">{value ?? <span className="text-muted-foreground">—</span>}</dd>
    </div>
  );
}

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string; q?: string; s?: string; label?: string }>;
}) {
  const { c, q, s, label } = await searchParams;
  const query = (q ?? "").trim();
  const labelFilter = (label ?? "").trim();
  const tab = TABS.find((t) => t.key === (s ?? "all")) ?? TABS[0];
  const ctx = await requireAuth();

  const [data, agents, members, allLabels, canned, macros, channel, widget, connection] = await Promise.all([
    withTenant(ctx.workspaceId, async (tx) => {
      const where: Prisma.ConversationWhereInput = {
        ...(tab.status ? { status: tab.status } : {}),
        ...(labelFilter ? { labels: { some: { labelId: labelFilter } } } : {}),
        ...(query
          ? {
              OR: [
                { customerName: { contains: query, mode: "insensitive" } },
                { customerPhone: { contains: query, mode: "insensitive" } },
              ],
            }
          : {}),
      };
      const convos = await tx.conversation.findMany({
        where,
        orderBy: { lastMessageAt: "desc" },
        take: 100,
        include: { labels: { include: { label: true } } },
      });
      const activeId = c && convos.some((x) => x.id === c) ? c : convos[0]?.id;
      const active = convos.find((x) => x.id === activeId) ?? null;
      const messages = activeId
        ? await tx.message.findMany({ where: { conversationId: activeId }, orderBy: { createdAt: "asc" }, take: 200 })
        : [];
      const contact = active?.contactId
        ? await tx.contact.findFirst({ where: { id: active.contactId, deletedAt: null } })
        : null;
      const company = contact?.companyId
        ? await tx.company.findFirst({ where: { id: contact.companyId }, select: { id: true, name: true } })
        : null;
      return { convos, active, messages, contact, company };
    }),
    withTenant(ctx.workspaceId, (tx) =>
      tx.aiAgent.findMany({ where: { deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    ),
    prisma.workspaceMember.findMany({
      where: { workspaceId: ctx.workspaceId },
      include: { user: { select: { id: true, fullName: true } } },
    }),
    withTenant(ctx.workspaceId, (tx) =>
      tx.label.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, color: true } }),
    ),
    withTenant(ctx.workspaceId, (tx) =>
      tx.cannedResponse.findMany({
        orderBy: { shortcode: "asc" },
        select: { id: true, shortcode: true, title: true, content: true },
      }),
    ),
    withTenant(ctx.workspaceId, (tx) =>
      tx.macro.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    ),
    prisma.whatsAppChannel.findFirst({ where: { workspaceId: ctx.workspaceId } }),
    prisma.webWidget.findFirst({ where: { workspaceId: ctx.workspaceId } }),
    prisma.channelConnection.findFirst({ where: { workspaceId: ctx.workspaceId, enabled: true } }),
  ]);

  const memberList = members.map((m) => ({ id: m.user.id, name: m.user.fullName }));
  const memberNameById = new Map(memberList.map((m) => [m.id, m.name]));
  const CHANNEL_LABEL: Record<string, string> = {
    whatsapp: "WhatsApp",
    webchat: "Web chat",
    messenger: "Messenger",
    instagram: "Instagram",
    tiktok: "TikTok",
  };
  const channelDisplay = (cv: { channelType: string; customerPhone: string }) =>
    cv.channelType === "whatsapp" ? cv.customerPhone : CHANNEL_LABEL[cv.channelType] ?? cv.channelType;
  const labelsOf = (cv: { labels: { label: { id: string; name: string; color: string } }[] }) =>
    cv.labels.map((cl) => cl.label);

  const settingsBtn = (
    <div className="flex flex-wrap gap-2">
      <Link href="/app/inbox/canned">
        <Button variant="outline" size="sm">Canned</Button>
      </Link>
      <Link href="/app/inbox/macros">
        <Button variant="outline" size="sm">Macros</Button>
      </Link>
      <Link href="/app/inbox/widget">
        <Button variant="outline" size="sm">Web widget</Button>
      </Link>
      <Link href="/app/inbox/channels">
        <Button variant="outline" size="sm">Meta / TikTok</Button>
      </Link>
      <Link href="/app/inbox/settings">
        <Button variant="outline" className="gap-2">
          <Settings className="h-4 w-4" /> WhatsApp
        </Button>
      </Link>
    </div>
  );

  if (!channel && !widget && !connection && data.convos.length === 0) {
    return (
      <div>
        <PageHeader title="Inbox" description="Connect a channel to start receiving messages." action={settingsBtn} />
        <Card className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <MessageSquare className="h-10 w-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No channels connected yet.</p>
          <div className="flex flex-wrap justify-center gap-2">
            <Link href="/app/inbox/settings">
              <Button>Connect WhatsApp</Button>
            </Link>
            <Link href="/app/inbox/channels">
              <Button variant="outline">Meta / TikTok</Button>
            </Link>
            <Link href="/app/inbox/widget">
              <Button variant="outline">Website chat widget</Button>
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  const showThread = Boolean(data.active);
  const rawAttrs = data.active?.customAttributes;
  const attrEntries =
    rawAttrs && typeof rawAttrs === "object" && !Array.isArray(rawAttrs)
      ? Object.entries(rawAttrs as Record<string, unknown>).filter(([, v]) => v != null && v !== "")
      : [];
  const activeContactName = data.contact
    ? [data.contact.firstName, data.contact.lastName].filter(Boolean).join(" ") ||
      data.active?.customerName ||
      data.active?.customerPhone
    : data.active?.customerName || data.active?.customerPhone;
  const tabHref = (key: string) => {
    const p = new URLSearchParams();
    if (key !== "all") p.set("s", key);
    if (query) p.set("q", query);
    if (labelFilter) p.set("label", labelFilter);
    return `/app/inbox${p.toString() ? `?${p}` : ""}`;
  };
  const labelHref = (id: string) => {
    const p = new URLSearchParams();
    if (tab.key !== "all") p.set("s", tab.key);
    if (query) p.set("q", query);
    if (id) p.set("label", id);
    return `/app/inbox${p.toString() ? `?${p}` : ""}`;
  };

  return (
    <div>
      <PageHeader
        title="Inbox"
        description={channel?.displayName ?? (widget ? "Website chat" : "All conversations")}
        action={settingsBtn}
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[300px_minmax(0,1fr)_340px]">
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
            {allLabels.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {labelFilter && (
                  <Link href={labelHref("")} className="rounded-full bg-secondary px-2 py-0.5 text-[11px] text-muted-foreground">
                    ✕ clear label
                  </Link>
                )}
                {allLabels.map((l) => (
                  <Link
                    key={l.id}
                    href={labelHref(l.id)}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]",
                      labelFilter === l.id ? "text-white" : "text-muted-foreground hover:bg-accent",
                    )}
                    style={labelFilter === l.id ? { backgroundColor: l.color } : undefined}
                  >
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: l.color }} />
                    {l.name}
                  </Link>
                ))}
              </div>
            )}
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
                        <LabelDots labels={labelsOf(cv)} />
                        <PriorityDot priority={cv.priority} />
                        <StatusTag status={cv.status} />
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{channelDisplay(cv)}</span>
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
                    <div className="font-medium">{data.active.customerName || channelDisplay(data.active)}</div>
                    <div className="text-xs text-muted-foreground">{channelDisplay(data.active)}</div>
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
                  <MacroRunner conversationId={data.active.id} macros={macros} />
                  <AssignAgentSelect
                    conversationId={data.active.id}
                    agents={agents}
                    current={data.active.assignedAgentId}
                  />
                </div>
              </div>

              <div className="border-b border-border px-3 py-2">
                <ConversationLabels
                  conversationId={data.active.id}
                  applied={labelsOf(data.active)}
                  allLabels={allLabels}
                />
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

              <ReplyForm conversationId={data.active.id} canned={canned} />
            </>
          ) : (
            <p className="p-6 text-center text-sm text-muted-foreground">Select a conversation.</p>
          )}
        </Card>

        {/* Contact details */}
        <Card className="hidden flex-col xl:flex">
          {data.active ? (
            <>
              <div className="flex items-center justify-between gap-2 border-b border-border p-3">
                <div className="text-sm font-semibold">Contact details</div>
                {data.contact && (
                  <Link href={`/app/contacts/${data.contact.id}`} className="text-xs font-medium text-primary hover:underline">
                    Open contact
                  </Link>
                )}
              </div>
              <div className="flex-1 space-y-4 overflow-y-auto p-4" style={{ maxHeight: "calc(100vh - 16rem)" }}>
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                    {(activeContactName || "?").slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate font-semibold">{activeContactName}</div>
                    <div className="text-xs text-muted-foreground">{CHANNEL_LABEL[data.active.channelType] ?? data.active.channelType}</div>
                  </div>
                </div>

                <dl className="space-y-2 border-t border-border pt-3 text-sm">
                  <DetailRow label="Phone" value={data.contact?.phone || data.active.customerPhone} />
                  <DetailRow label="Email" value={data.contact?.email} />
                  <DetailRow label="Job title" value={data.contact?.jobTitle} />
                  <DetailRow
                    label="Company"
                    value={data.company ? <Link href={`/app/companies/${data.company.id}`} className="text-primary hover:underline">{data.company.name}</Link> : null}
                  />
                  <DetailRow label="Status" value={<StatusTag status={data.active.status} />} />
                  <DetailRow label="Assigned" value={data.active.assignedUserId ? memberNameById.get(data.active.assignedUserId) : null} />
                </dl>

                {attrEntries.length > 0 && (
                  <div className="border-t border-border pt-3">
                    <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Contact fields</div>
                    <dl className="space-y-2 text-sm">
                      {attrEntries.map(([k, v]) => (
                        <DetailRow key={k} label={k} value={String(v)} />
                      ))}
                    </dl>
                  </div>
                )}

                {labelsOf(data.active).length > 0 && (
                  <div className="border-t border-border pt-3">
                    <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Labels</div>
                    <div className="flex flex-wrap gap-1.5">
                      {labelsOf(data.active).map((l) => (
                        <span key={l.id} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] text-white" style={{ backgroundColor: l.color }}>
                          {l.name}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {!data.contact && (
                  <p className="rounded-md bg-secondary/50 p-2.5 text-xs text-muted-foreground">
                    No CRM contact linked to this conversation yet.
                  </p>
                )}
              </div>
            </>
          ) : (
            <p className="p-6 text-center text-sm text-muted-foreground">Select a conversation.</p>
          )}
        </Card>
      </div>
    </div>
  );
}
