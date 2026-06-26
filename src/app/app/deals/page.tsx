import Link from "next/link";
import { Plus, CircleDollarSign } from "lucide-react";
import { requireAuth } from "@/lib/auth";
import { withTenant } from "@/lib/tenant";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { MoveDealSelect } from "@/components/app/move-deal-select";
import { formatCurrency } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function DealsPage() {
  const ctx = await requireAuth();

  const board = await withTenant(ctx.workspaceId, async (tx) => {
    const pipeline =
      (await tx.pipeline.findFirst({ where: { isDefault: true }, orderBy: { position: "asc" } })) ??
      (await tx.pipeline.findFirst({ orderBy: { position: "asc" } }));
    if (!pipeline) return null;

    const [stages, deals] = await Promise.all([
      tx.stage.findMany({ where: { pipelineId: pipeline.id }, orderBy: { position: "asc" } }),
      tx.deal.findMany({
        where: { pipelineId: pipeline.id, deletedAt: null },
        orderBy: { createdAt: "desc" },
        include: { company: { select: { name: true } } },
      }),
    ]);
    return { pipeline, stages, deals };
  });

  const newButton = (
    <Link href="/app/deals/new">
      <Button className="gap-2">
        <Plus className="h-4 w-4" /> New deal
      </Button>
    </Link>
  );

  if (!board) {
    return (
      <div>
        <PageHeader title="Deals" description="Track your pipeline." action={newButton} />
        <Card className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <CircleDollarSign className="h-10 w-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No pipeline configured.</p>
        </Card>
      </div>
    );
  }

  const stageMeta = board.stages.map((s) => ({ id: s.id, name: s.name }));

  return (
    <div>
      <PageHeader title="Deals" description={`Pipeline: ${board.pipeline.name}`} action={newButton} />
      <div className="flex gap-4 overflow-x-auto pb-4">
        {board.stages.map((stage) => {
          const stageDeals = board.deals.filter((d) => d.stageId === stage.id);
          const total = stageDeals.reduce((sum, d) => sum + (d.amount ? Number(d.amount) : 0), 0);
          return (
            <div key={stage.id} className="flex w-72 shrink-0 flex-col">
              <div className="mb-2 flex items-center justify-between px-1">
                <span className="text-sm font-semibold">{stage.name}</span>
                <span className="text-xs text-muted-foreground">
                  {stageDeals.length} · {formatCurrency(total)}
                </span>
              </div>
              <div className="flex flex-col gap-2">
                {stageDeals.map((d) => (
                  <Card key={d.id} className="p-3">
                    <Link href={`/app/deals/${d.id}`} className="text-sm font-medium hover:underline">
                      {d.title}
                    </Link>
                    <div className="mt-1 text-sm text-muted-foreground">
                      {formatCurrency(d.amount ? Number(d.amount) : null, d.currency)}
                    </div>
                    {d.company?.name && (
                      <div className="text-xs text-muted-foreground">{d.company.name}</div>
                    )}
                    <div className="mt-2">
                      <MoveDealSelect dealId={d.id} stageId={stage.id} stages={stageMeta} />
                    </div>
                  </Card>
                ))}
                {stageDeals.length === 0 && (
                  <div className="rounded-md border border-dashed border-border py-6 text-center text-xs text-muted-foreground">
                    No deals
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
