import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { requireAuth } from "@/lib/auth";
import { withTenant } from "@/lib/tenant";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/app/page-header";
import { TaskComposer } from "@/components/app/task-composer";
import { TaskItem } from "@/components/app/task-item";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "open", label: "Open" },
  { key: "mine", label: "Assigned to me" },
  { key: "done", label: "Completed" },
];

const PARENT_PATH = { CONTACT: "/app/contacts", COMPANY: "/app/companies", DEAL: "/app/deals" } as const;

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ f?: string }> }) {
  const { f } = await searchParams;
  const tab = TABS.find((t) => t.key === f) ?? TABS[0];
  const ctx = await requireAuth();

  const where: Prisma.TaskWhereInput =
    tab.key === "done"
      ? { status: "DONE" }
      : tab.key === "mine"
        ? { status: { not: "DONE" }, assigneeId: ctx.userId }
        : { status: { not: "DONE" } };

  const [tasks, members] = await Promise.all([
    withTenant(ctx.workspaceId, (tx) =>
      tx.task.findMany({ where, orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }], take: 200 }),
    ),
    prisma.workspaceMember.findMany({
      where: { workspaceId: ctx.workspaceId },
      include: { user: { select: { id: true, fullName: true } } },
    }),
  ]);
  const memberList = members.map((m) => ({ id: m.user.id, name: m.user.fullName }));
  const nameById = new Map(memberList.map((m) => [m.id, m.name]));

  // Resolve parent record names for the linked-from labels.
  const ids = (t: string) => tasks.filter((x) => x.parentType === t && x.parentId).map((x) => x.parentId!) as string[];
  const parentNames = await withTenant(ctx.workspaceId, async (tx) => {
    const [contacts, companies, deals] = await Promise.all([
      tx.contact.findMany({ where: { id: { in: ids("CONTACT") } }, select: { id: true, firstName: true, lastName: true, email: true } }),
      tx.company.findMany({ where: { id: { in: ids("COMPANY") } }, select: { id: true, name: true } }),
      tx.deal.findMany({ where: { id: { in: ids("DEAL") } }, select: { id: true, title: true } }),
    ]);
    const map = new Map<string, string>();
    contacts.forEach((c) => map.set(`CONTACT:${c.id}`, [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || "Contact"));
    companies.forEach((c) => map.set(`COMPANY:${c.id}`, c.name));
    deals.forEach((d) => map.set(`DEAL:${d.id}`, d.title));
    return map;
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Tasks" description="Everything your team needs to follow up on." />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">New task</CardTitle>
        </CardHeader>
        <CardContent>
          <TaskComposer members={memberList} compact={false} />
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-1">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/app/tasks${t.key === "open" ? "" : `?f=${t.key}`}`}
            className={cn(
              "rounded-full px-3 py-1 text-sm font-medium transition-colors",
              tab.key === t.key ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent",
            )}
          >
            {t.label}
          </Link>
        ))}
      </div>

      <div className="space-y-2">
        {tasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">No tasks here.</p>
        ) : (
          tasks.map((t) => {
            const key = t.parentType && t.parentId ? `${t.parentType}:${t.parentId}` : null;
            return (
              <TaskItem
                key={t.id}
                task={{ id: t.id, title: t.title, status: t.status, dueAt: t.dueAt ? t.dueAt.toISOString() : null }}
                assigneeName={t.assigneeId ? nameById.get(t.assigneeId) : undefined}
                parentHref={t.parentType && t.parentId ? `${PARENT_PATH[t.parentType]}/${t.parentId}` : undefined}
                parentLabel={key ? parentNames.get(key) : undefined}
              />
            );
          })
        )}
      </div>
    </div>
  );
}
