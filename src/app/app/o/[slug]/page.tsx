import Link from "next/link";
import { notFound } from "next/navigation";
import { Plus, Table2 } from "lucide-react";
import { requireAuth } from "@/lib/auth";
import { withTenant } from "@/lib/tenant";
import { relationOptions } from "@/lib/object-data";
import { relationTarget, isRelationType, formatFieldValue } from "@/lib/custom-objects";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function RecordsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireAuth();

  const data = await withTenant(ctx.workspaceId, async (tx) => {
    const def = await tx.objectDefinition.findFirst({
      where: { slug },
      include: { fields: { orderBy: { position: "asc" } } },
    });
    if (!def) return null;
    const records = await tx.customRecord.findMany({
      where: { objectDefinitionId: def.id, deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    const relMaps: Record<string, Map<string, string>> = {};
    for (const f of def.fields) {
      if (isRelationType(f.type)) {
        const t = relationTarget(f.options);
        if (t) relMaps[f.key] = new Map((await relationOptions(tx, t)).map((o) => [o.id, o.label]));
      }
    }
    return { def, records, relMaps };
  });
  if (!data) notFound();
  const { def, records, relMaps } = data;
  const cols = def.fields.slice(0, 5);

  const cell = (f: { key: string; type: string }, values: Record<string, unknown>) => {
    const v = values[f.key];
    if (v == null || v === "") return "—";
    if (f.type === "relation") return relMaps[f.key]?.get(String(v)) ?? String(v);
    if (f.type === "relations") {
      const arr = Array.isArray(v) ? v : [];
      const m = relMaps[f.key];
      return arr.map((id) => m?.get(String(id)) ?? String(id)).join(", ") || "—";
    }
    return formatFieldValue(f.type, v);
  };

  return (
    <div>
      <PageHeader
        title={def.namePlural}
        description={`Custom object · ${records.length} record${records.length === 1 ? "" : "s"}`}
        action={
          <Link href={`/app/o/${slug}/new`}>
            <Button className="gap-2">
              <Plus className="h-4 w-4" /> New {def.nameSingular.toLowerCase()}
            </Button>
          </Link>
        }
      />

      {records.length === 0 ? (
        <Card className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <Table2 className="h-10 w-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No {def.namePlural.toLowerCase()} yet.</p>
          <Link href={`/app/o/${slug}/new`}>
            <Button className="gap-2">
              <Plus className="h-4 w-4" /> Add the first one
            </Button>
          </Link>
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-secondary/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                {cols.map((f) => (
                  <th key={f.key} className="px-4 py-3 font-medium">{f.label}</th>
                ))}
                {cols.length === 0 && <th className="px-4 py-3 font-medium">Record</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {records.map((r) => {
                const values = r.values as Record<string, unknown>;
                return (
                  <tr key={r.id} className="hover:bg-accent/40">
                    {cols.map((f, i) => (
                      <td key={f.key} className="px-4 py-3">
                        {i === 0 ? (
                          <Link href={`/app/o/${slug}/${r.id}`} className="font-medium hover:underline">
                            {cell(f, values)}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">{cell(f, values)}</span>
                        )}
                      </td>
                    ))}
                    {cols.length === 0 && (
                      <td className="px-4 py-3">
                        <Link href={`/app/o/${slug}/${r.id}`} className="font-medium hover:underline">
                          Open
                        </Link>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
