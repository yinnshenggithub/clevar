import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowUp, ArrowDown, Star, Plus } from "lucide-react";
import { requireAuth, canManageWorkspace } from "@/lib/auth";
import { withTenant } from "@/lib/tenant";
import {
  renamePipeline,
  setDefaultPipeline,
  deletePipeline,
  addStage,
  renameStage,
  deleteStage,
  reorderStage,
} from "@/lib/actions/pipelines";
import { PageHeader } from "@/components/app/page-header";
import { CreatePipelineForm } from "@/components/app/create-pipeline-form";
import { DeleteButton } from "@/components/app/delete-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

const STAGE_TYPES = ["OPEN", "WON", "LOST"] as const;
const stageTypeLabel: Record<string, string> = { OPEN: "Open", WON: "Won", LOST: "Lost" };

export default async function PipelinesSettingsPage() {
  const ctx = await requireAuth();
  if (!canManageWorkspace(ctx.role)) notFound();

  const pipelines = await withTenant(ctx.workspaceId, async (tx) => {
    const pls = await tx.pipeline.findMany({ orderBy: { position: "asc" } });
    return Promise.all(
      pls.map(async (p) => {
        const stages = await tx.stage.findMany({ where: { pipelineId: p.id }, orderBy: { position: "asc" } });
        const dealCount = await tx.deal.count({ where: { pipelineId: p.id, deletedAt: null } });
        return { ...p, stages, dealCount };
      }),
    );
  });

  const total = pipelines.length;

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title="Pipelines"
        description="Create deal pipelines and define the funnel stages for each."
        action={
          <Link href="/app/deals">
            <Button variant="ghost" className="gap-2">
              <ArrowLeft className="h-4 w-4" /> Deals
            </Button>
          </Link>
        }
      />

      {pipelines.map((p) => {
        const canDelete = total > 1 && p.dealCount === 0;
        return (
          <Card key={p.id}>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
              <div className="flex items-center gap-2">
                <CardTitle className="text-base">{p.name}</CardTitle>
                {p.isDefault && <Badge variant="secondary">Default</Badge>}
                <span className="text-xs text-muted-foreground">{p.dealCount} deal{p.dealCount === 1 ? "" : "s"}</span>
              </div>
              <div className="flex items-center gap-2">
                {!p.isDefault && (
                  <form action={setDefaultPipeline.bind(null, p.id)}>
                    <Button type="submit" variant="ghost" size="sm" className="gap-1">
                      <Star className="h-3.5 w-3.5" /> Set default
                    </Button>
                  </form>
                )}
                {canDelete && (
                  <DeleteButton action={deletePipeline.bind(null, p.id)} label="" confirmText={`Delete pipeline "${p.name}"?`} />
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <form action={renamePipeline.bind(null, p.id)} className="flex gap-2">
                <Input name="name" defaultValue={p.name} className="flex-1" aria-label="Pipeline name" />
                <Button type="submit" variant="outline" size="sm">Rename</Button>
              </form>

              <div>
                <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Stages</div>
                <ul className="divide-y divide-border rounded-md border border-border">
                  {p.stages.map((s, i) => (
                    <li key={s.id} className="flex items-center gap-2 px-3 py-2">
                      <form action={renameStage.bind(null, s.id)} className="flex flex-1 items-center gap-2">
                        <Input name="name" defaultValue={s.name} className="h-8 flex-1 text-sm" aria-label="Stage name" />
                        <Select name="stageType" defaultValue={s.stageType} className="h-8 w-24 text-xs" aria-label="Stage type">
                          {STAGE_TYPES.map((t) => (
                            <option key={t} value={t}>{stageTypeLabel[t]}</option>
                          ))}
                        </Select>
                        <Button type="submit" variant="ghost" size="sm" className="h-8">Save</Button>
                      </form>
                      <div className="flex shrink-0 items-center gap-1">
                        <form action={reorderStage.bind(null, s.id, "up")}>
                          <button type="submit" disabled={i === 0} className="rounded p-1 text-muted-foreground hover:bg-accent disabled:opacity-30" aria-label="Move stage up">
                            <ArrowUp className="h-4 w-4" />
                          </button>
                        </form>
                        <form action={reorderStage.bind(null, s.id, "down")}>
                          <button type="submit" disabled={i === p.stages.length - 1} className="rounded p-1 text-muted-foreground hover:bg-accent disabled:opacity-30" aria-label="Move stage down">
                            <ArrowDown className="h-4 w-4" />
                          </button>
                        </form>
                        {p.stages.length > 1 && (
                          <DeleteButton action={deleteStage.bind(null, s.id)} label="" confirmText={`Delete stage "${s.name}"?`} />
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
                <form action={addStage.bind(null, p.id)} className="mt-2 flex gap-2">
                  <Input name="name" placeholder="New stage name" className="h-8 flex-1 text-sm" required />
                  <Select name="stageType" defaultValue="OPEN" className="h-8 w-24 text-xs" aria-label="New stage type">
                    {STAGE_TYPES.map((t) => (
                      <option key={t} value={t}>{stageTypeLabel[t]}</option>
                    ))}
                  </Select>
                  <Button type="submit" variant="outline" size="sm" className="h-8 gap-1"><Plus className="h-3.5 w-3.5" /> Add</Button>
                </form>
              </div>
            </CardContent>
          </Card>
        );
      })}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Create a pipeline</CardTitle>
        </CardHeader>
        <CardContent>
          <CreatePipelineForm />
        </CardContent>
      </Card>
    </div>
  );
}
