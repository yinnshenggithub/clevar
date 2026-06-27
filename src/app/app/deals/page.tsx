import Link from "next/link";
import { Plus, CircleDollarSign, Upload, Download, SlidersHorizontal } from "lucide-react";
import { requireAuth } from "@/lib/auth";
import { withTenant } from "@/lib/tenant";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DealsBoard } from "@/components/app/deals-board";

export const dynamic = "force-dynamic";

export default async function DealsPage({
  searchParams,
}: {
  searchParams: Promise<{ pipeline?: string; view?: string }>;
}) {
  const ctx = await requireAuth();
  const sp = await searchParams;
  const view = sp.view === "table" ? "table" : "kanban";

  const board = await withTenant(ctx.workspaceId, async (tx) => {
    const pipelines = await tx.pipeline.findMany({ orderBy: { position: "asc" } });
    if (pipelines.length === 0) return null;
    const current =
      pipelines.find((p) => p.id === sp.pipeline) ??
      pipelines.find((p) => p.isDefault) ??
      pipelines[0];

    const [stages, deals] = await Promise.all([
      tx.stage.findMany({ where: { pipelineId: current.id }, orderBy: { position: "asc" } }),
      tx.deal.findMany({
        where: { pipelineId: current.id, deletedAt: null },
        orderBy: { createdAt: "desc" },
        include: { company: { select: { name: true } } },
      }),
    ]);
    return { pipelines, current, stages, deals };
  });

  const newButton = (
    <div className="flex flex-wrap items-center gap-2">
      <Link href="/app/settings/pipelines">
        <Button variant="outline" className="gap-2">
          <SlidersHorizontal className="h-4 w-4" /> Pipelines
        </Button>
      </Link>
      <a href="/api/export?object=deals">
        <Button variant="outline" className="gap-2">
          <Download className="h-4 w-4" /> Export
        </Button>
      </a>
      <Link href="/app/import/deals">
        <Button variant="outline" className="gap-2">
          <Upload className="h-4 w-4" /> Import
        </Button>
      </Link>
      <Link href="/app/deals/new">
        <Button className="gap-2">
          <Plus className="h-4 w-4" /> New deal
        </Button>
      </Link>
    </div>
  );

  if (!board) {
    return (
      <div>
        <PageHeader title="Deals" description="Track your pipeline." action={newButton} />
        <Card className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <CircleDollarSign className="h-10 w-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No pipeline configured.</p>
          <Link href="/app/settings/pipelines">
            <Button variant="outline" className="gap-2"><Plus className="h-4 w-4" /> Create a pipeline</Button>
          </Link>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Deals"
        description={board.pipelines.length > 1 ? "Switch pipelines and drag deals between stages." : `Pipeline: ${board.current.name}`}
        action={newButton}
      />
      <DealsBoard
        pipelines={board.pipelines.map((p) => ({ id: p.id, name: p.name }))}
        currentPipelineId={board.current.id}
        stages={board.stages.map((s) => ({ id: s.id, name: s.name }))}
        deals={board.deals.map((d) => ({
          id: d.id,
          title: d.title,
          amount: d.amount ? Number(d.amount) : null,
          currency: d.currency,
          companyName: d.company?.name ?? null,
          stageId: d.stageId,
        }))}
        view={view}
      />
    </div>
  );
}
