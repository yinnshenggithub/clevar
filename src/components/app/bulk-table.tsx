"use client";

import { useState, useTransition, type ReactNode } from "react";
import { Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface BulkRow {
  id: string;
  cells: ReactNode[];
}

export function BulkTable({
  columns,
  rows,
  deleteAction,
  noun = "item",
}: {
  columns: string[];
  rows: BulkRow[];
  deleteAction: (ids: string[]) => Promise<void>;
  noun?: string;
}) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const allChecked = rows.length > 0 && sel.size === rows.length;

  const toggle = (id: string) =>
    setSel((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  const toggleAll = () => setSel(allChecked ? new Set() : new Set(rows.map((r) => r.id)));

  const onDelete = () => {
    const ids = [...sel];
    if (!ids.length) return;
    if (!window.confirm(`Delete ${ids.length} ${noun}${ids.length === 1 ? "" : "s"}? This cannot be undone.`)) return;
    start(async () => {
      await deleteAction(ids);
      setSel(new Set());
    });
  };

  return (
    <div className="space-y-2">
      {sel.size > 0 && (
        <div className="flex items-center justify-between rounded-lg border border-primary/30 bg-primary/5 px-4 py-2 text-sm">
          <span className="font-medium">{sel.size} selected</span>
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setSel(new Set())}>
              Clear
            </Button>
            <Button type="button" variant="outline" size="sm" className="gap-1.5 text-destructive hover:bg-destructive/10" disabled={pending} onClick={onDelete}>
              <Trash2 className="h-4 w-4" /> Delete
            </Button>
          </div>
        </div>
      )}
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-secondary/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="w-10 px-4 py-3">
                <input type="checkbox" checked={allChecked} onChange={toggleAll} aria-label="Select all" className="h-4 w-4" />
              </th>
              {columns.map((c) => (
                <th key={c} className="px-4 py-3 font-medium">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <tr key={r.id} className={cn("hover:bg-accent/40", sel.has(r.id) && "bg-primary/5")}>
                <td className="px-4 py-3">
                  <input type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)} aria-label="Select row" className="h-4 w-4" />
                </td>
                {r.cells.map((cell, i) => (
                  <td key={i} className="px-4 py-3">{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
