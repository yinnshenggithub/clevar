import { requireAuth } from "@/lib/auth";
import { withTenant } from "@/lib/tenant";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

function money(n: number): string {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}
function duration(mins: number): string {
  if (!mins || mins < 1) return "—";
  if (mins < 60) return `${Math.round(mins)}m`;
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return m ? `${h}h ${m}m` : `${h}h`;
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-sm text-muted-foreground">{label}</div>
        <div className="mt-1 font-display text-2xl font-bold tracking-tight">{value}</div>
        {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );
}

export default async function ReportsPage() {
  const ctx = await requireAuth();
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const last30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const data = await withTenant(ctx.workspaceId, async (tx) => {
    const [
      contactCount,
      companyCount,
      openAgg,
      wonMonthAgg,
      lostCount,
      stageGroups,
      stages,
      convByStatus,
      timings,
      msgByDir,
      tasksOpen,
      tasksDone,
      tasksOverdue,
    ] = await Promise.all([
      tx.contact.count({ where: { deletedAt: null } }),
      tx.company.count({ where: { deletedAt: null } }),
      tx.deal.aggregate({ where: { deletedAt: null, status: "OPEN" }, _sum: { amount: true }, _count: { _all: true } }),
      tx.deal.aggregate({ where: { deletedAt: null, status: "WON", updatedAt: { gte: monthStart } }, _sum: { amount: true }, _count: { _all: true } }),
      tx.deal.count({ where: { deletedAt: null, status: "LOST" } }),
      tx.deal.groupBy({ by: ["stageId"], where: { deletedAt: null }, _count: { _all: true }, _sum: { amount: true } }),
      tx.stage.findMany({ orderBy: [{ pipelineId: "asc" }, { position: "asc" }], select: { id: true, name: true } }),
      tx.conversation.groupBy({ by: ["status"], _count: { _all: true } }),
      tx.conversation.findMany({ where: { firstReplyAt: { not: null } }, select: { createdAt: true, firstReplyAt: true }, take: 1000 }),
      tx.message.groupBy({ by: ["direction"], where: { createdAt: { gte: last30 } }, _count: { _all: true } }),
      tx.task.count({ where: { status: { not: "DONE" } } }),
      tx.task.count({ where: { status: "DONE" } }),
      tx.task.count({ where: { status: { not: "DONE" }, dueAt: { lt: now } } }),
    ]);
    const credits = await tx.workspaceCredits.findUnique({ where: { workspaceId: ctx.workspaceId } });
    return {
      contactCount,
      companyCount,
      openAgg,
      wonMonthAgg,
      lostCount,
      stageGroups,
      stageName: new Map(stages.map((s) => [s.id, s.name])),
      convByStatus,
      timings,
      msgByDir,
      tasksOpen,
      tasksDone,
      tasksOverdue,
      credits,
    };
  });

  const openValue = Number(data.openAgg._sum.amount ?? 0);
  const openCount = data.openAgg._count._all;
  const wonValue = Number(data.wonMonthAgg._sum.amount ?? 0);
  const wonCount = data.wonMonthAgg._count._all;

  const frtMins =
    data.timings.length > 0
      ? data.timings.reduce((acc, c) => acc + (c.firstReplyAt!.getTime() - c.createdAt.getTime()) / 60000, 0) /
        data.timings.length
      : 0;

  const statusCount = (s: string) => data.convByStatus.find((x) => x.status === s)?._count._all ?? 0;
  const convTotal = data.convByStatus.reduce((a, x) => a + x._count._all, 0);
  const dirCount = (d: string) => data.msgByDir.find((x) => x.direction === d)?._count._all ?? 0;

  const maxStage = Math.max(1, ...data.stageGroups.map((g) => g._count._all));
  const creditsUsed = data.credits?.used ?? 0;
  const creditsLimit = data.credits?.monthlyLimit ?? 1000;

  return (
    <div className="space-y-8">
      <PageHeader title="Reports" description="Live view of your pipeline, support, and team activity." />

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Sales</h2>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat label="Open pipeline" value={money(openValue)} hint={`${openCount} open deal${openCount === 1 ? "" : "s"}`} />
          <Stat label="Won this month" value={money(wonValue)} hint={`${wonCount} deal${wonCount === 1 ? "" : "s"}`} />
          <Stat label="Contacts" value={data.contactCount.toLocaleString()} />
          <Stat label="Companies" value={data.companyCount.toLocaleString()} />
        </div>
        {data.stageGroups.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Pipeline by stage</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {data.stageGroups.map((g) => {
                const count = g._count._all;
                return (
                  <div key={g.stageId} className="flex items-center gap-3">
                    <div className="w-40 shrink-0 truncate text-sm">{data.stageName.get(g.stageId) ?? "Stage"}</div>
                    <div className="h-5 flex-1 overflow-hidden rounded bg-secondary">
                      <div className="h-full rounded bg-primary" style={{ width: `${(count / maxStage) * 100}%` }} />
                    </div>
                    <div className="w-32 shrink-0 text-right text-sm text-muted-foreground">
                      {count} · {money(Number(g._sum.amount ?? 0))}
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Support inbox</h2>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat label="Conversations" value={convTotal.toLocaleString()} />
          <Stat label="Open / pending" value={`${statusCount("OPEN") + statusCount("PENDING")}`} hint={`${statusCount("RESOLVED")} resolved`} />
          <Stat label="Avg. first response" value={duration(frtMins)} hint={`${data.timings.length} replied`} />
          <Stat label="Messages (30d)" value={(dirCount("INBOUND") + dirCount("OUTBOUND")).toLocaleString()} hint={`${dirCount("INBOUND")} in · ${dirCount("OUTBOUND")} out`} />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Team &amp; usage</h2>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat label="Open tasks" value={data.tasksOpen.toLocaleString()} hint={`${data.tasksOverdue} overdue`} />
          <Stat label="Completed tasks" value={data.tasksDone.toLocaleString()} />
          <Stat label="AI credits used" value={`${creditsUsed.toLocaleString()} / ${creditsLimit.toLocaleString()}`} hint={`${Math.round((creditsUsed / Math.max(1, creditsLimit)) * 100)}% of monthly`} />
          <Stat label="Deals lost" value={data.lostCount.toLocaleString()} />
        </div>
      </section>
    </div>
  );
}
