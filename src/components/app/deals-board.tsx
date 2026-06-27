"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, LayoutGrid, Table2 } from "lucide-react";
import { moveDeal } from "@/lib/actions/deals";
import { quickCreateDeal as quickCreate } from "@/lib/actions/pipelines";
import { formatCurrency } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { MoveDealSelect } from "@/components/app/move-deal-select";

export interface BoardDeal {
  id: string;
  title: string;
  amount: number | null;
  currency: string;
  companyName: string | null;
  stageId: string;
}
export interface BoardStage {
  id: string;
  name: string;
}
export interface BoardPipeline {
  id: string;
  name: string;
}

export function DealsBoard({
  pipelines,
  currentPipelineId,
  stages,
  deals: initialDeals,
  view,
}: {
  pipelines: BoardPipeline[];
  currentPipelineId: string;
  stages: BoardStage[];
  deals: BoardDeal[];
  view: "kanban" | "table";
}) {
  const router = useRouter();
  const [deals, setDeals] = useState<BoardDeal[]>(initialDeals);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // Re-sync to server truth after each refresh.
  useEffect(() => setDeals(initialDeals), [initialDeals]);

  const href = (pid: string, v: "kanban" | "table") => `/app/deals?pipeline=${pid}&view=${v}`;

  function handleDrop(stageId: string) {
    const id = dragId;
    setOverStage(null);
    setDragId(null);
    if (!id) return;
    const deal = deals.find((d) => d.id === id);
    if (!deal || deal.stageId === stageId) return;
    setDeals((prev) => prev.map((d) => (d.id === id ? { ...d, stageId } : d)));
    startTransition(async () => {
      await moveDeal(id, stageId);
      router.refresh();
    });
  }

  const viewToggle = (
    <div className="inline-flex rounded-md border border-border p-0.5">
      <Link
        href={href(currentPipelineId, "kanban")}
        className={`inline-flex items-center gap-1 rounded px-2.5 py-1 text-xs font-medium ${view === "kanban" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
      >
        <LayoutGrid className="h-3.5 w-3.5" /> Board
      </Link>
      <Link
        href={href(currentPipelineId, "table")}
        className={`inline-flex items-center gap-1 rounded px-2.5 py-1 text-xs font-medium ${view === "table" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
      >
        <Table2 className="h-3.5 w-3.5" /> Table
      </Link>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {pipelines.length > 1 ? (
          <div className="flex flex-wrap items-center gap-1">
            {pipelines.map((p) => (
              <Link
                key={p.id}
                href={href(p.id, view)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium ${p.id === currentPipelineId ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/50"}`}
              >
                {p.name}
              </Link>
            ))}
          </div>
        ) : (
          <div />
        )}
        {viewToggle}
      </div>

      {view === "table" ? (
        <TableView deals={deals} stages={stages} />
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {stages.map((stage) => {
            const stageDeals = deals.filter((d) => d.stageId === stage.id);
            const total = stageDeals.reduce((sum, d) => sum + (d.amount ?? 0), 0);
            return (
              <div
                key={stage.id}
                className={`flex w-72 shrink-0 flex-col rounded-lg p-1 transition-colors ${overStage === stage.id ? "bg-primary/5 ring-2 ring-primary/40" : ""}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOverStage(stage.id);
                }}
                onDragLeave={() => setOverStage((s) => (s === stage.id ? null : s))}
                onDrop={() => handleDrop(stage.id)}
              >
                <div className="mb-2 flex items-center justify-between px-1">
                  <span className="text-sm font-semibold">{stage.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {stageDeals.length} · {formatCurrency(total)}
                  </span>
                </div>
                <div className="flex flex-col gap-2">
                  {stageDeals.map((d) => (
                    <Card
                      key={d.id}
                      draggable
                      onDragStart={() => setDragId(d.id)}
                      onDragEnd={() => {
                        setDragId(null);
                        setOverStage(null);
                      }}
                      className="cursor-grab p-3 active:cursor-grabbing"
                    >
                      <Link href={`/app/deals/${d.id}`} className="text-sm font-medium hover:underline">
                        {d.title}
                      </Link>
                      <div className="mt-1 text-sm text-muted-foreground">
                        {formatCurrency(d.amount, d.currency)}
                      </div>
                      {d.companyName && <div className="text-xs text-muted-foreground">{d.companyName}</div>}
                    </Card>
                  ))}
                  <QuickAdd pipelineId={currentPipelineId} stageId={stage.id} onDone={() => router.refresh()} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function QuickAdd({ pipelineId, stageId, onDone }: { pipelineId: string; stageId: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1 rounded-md border border-dashed border-border py-2 text-xs text-muted-foreground hover:border-primary/50 hover:text-foreground"
      >
        <Plus className="h-3.5 w-3.5" /> Add deal
      </button>
    );
  }
  return (
    <form
      action={(fd) => {
        startTransition(async () => {
          await quickCreate(pipelineId, stageId, fd);
          setOpen(false);
          onDone();
        });
      }}
      className="space-y-2 rounded-md border border-border p-2"
    >
      <Input name="title" placeholder="Deal title" autoFocus required className="h-8 text-sm" />
      <div className="flex gap-2">
        <Button type="submit" size="sm" className="h-7">Add</Button>
        <Button type="button" size="sm" variant="ghost" className="h-7" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function TableView({ deals, stages }: { deals: BoardDeal[]; stages: BoardStage[] }) {
  if (deals.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">No deals in this pipeline yet.</p>;
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">Deal</th>
            <th className="px-3 py-2 font-medium">Stage</th>
            <th className="px-3 py-2 font-medium">Amount</th>
            <th className="px-3 py-2 font-medium">Company</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {deals.map((d) => (
            <tr key={d.id} className="hover:bg-accent/30">
              <td className="px-3 py-2">
                <Link href={`/app/deals/${d.id}`} className="font-medium hover:underline">{d.title}</Link>
              </td>
              <td className="px-3 py-2">
                <MoveDealSelect dealId={d.id} stageId={d.stageId} stages={stages} />
              </td>
              <td className="px-3 py-2 text-muted-foreground">{formatCurrency(d.amount, d.currency)}</td>
              <td className="px-3 py-2 text-muted-foreground">{d.companyName ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
