import Link from "next/link";
import { Boxes, Settings2, Table2 } from "lucide-react";
import { requireAuth, canManageWorkspace } from "@/lib/auth";
import { withTenant } from "@/lib/tenant";
import { PageHeader } from "@/components/app/page-header";
import { ObjectForm } from "@/components/app/object-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function ObjectsPage() {
  const ctx = await requireAuth();
  const canManage = canManageWorkspace(ctx.role);
  const defs = await withTenant(ctx.workspaceId, (tx) =>
    tx.objectDefinition.findMany({
      orderBy: { createdAt: "asc" },
      include: { _count: { select: { fields: true, records: true } } },
    }),
  );

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader title="Custom objects" description="Define your own record types and link them to the CRM." />

      {defs.length === 0 ? (
        <Card className="flex flex-col items-center justify-center gap-2 py-10 text-center">
          <Boxes className="h-9 w-9 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No custom objects yet.</p>
        </Card>
      ) : (
        <Card>
          <CardContent className="divide-y divide-border p-0">
            {defs.map((d) => (
              <div key={d.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <div className="font-medium">{d.namePlural}</div>
                  <div className="text-xs text-muted-foreground">
                    {d._count.fields} field{d._count.fields === 1 ? "" : "s"} · {d._count.records} record
                    {d._count.records === 1 ? "" : "s"}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Link href={`/app/o/${d.slug}`}>
                    <Button variant="outline" size="sm" className="gap-2">
                      <Table2 className="h-4 w-4" /> Records
                    </Button>
                  </Link>
                  {canManage && (
                    <Link href={`/app/objects/${d.slug}`}>
                      <Button variant="outline" size="sm" className="gap-2">
                        <Settings2 className="h-4 w-4" /> Fields
                      </Button>
                    </Link>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">New object</CardTitle>
          </CardHeader>
          <CardContent>
            <ObjectForm />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
