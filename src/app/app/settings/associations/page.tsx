import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { requireAuth, canManageWorkspace } from "@/lib/auth";
import { withTenant } from "@/lib/tenant";
import { listAssociableObjects } from "@/lib/associations";
import { deleteAssociationType } from "@/lib/actions/associations";
import { PageHeader } from "@/components/app/page-header";
import { AssociationTypeForm } from "@/components/app/association-type-form";
import { DeleteButton } from "@/components/app/delete-button";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

const CARDINALITY_LABEL: Record<string, string> = {
  one_to_one: "One-to-one",
  one_to_many: "One-to-many",
  many_to_many: "Many-to-many",
};

export default async function AssociationsSettingsPage() {
  const ctx = await requireAuth();
  if (!canManageWorkspace(ctx.role)) notFound();

  const { types, objects } = await withTenant(ctx.workspaceId, async (tx) => {
    const types = await tx.associationType.findMany({ orderBy: { createdAt: "desc" } });
    const objects = await listAssociableObjects(tx);
    return { types, objects };
  });
  const labelOf = (v: string) => objects.find((o) => o.value === v)?.label ?? v;

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title="Associations"
        description="Define relationship types between records — these power the Associations panel on every contact, company, deal, and custom record."
        action={
          <Link href="/app/settings">
            <Button variant="ghost" className="gap-2"><ArrowLeft className="h-4 w-4" /> Settings</Button>
          </Link>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">New association type</CardTitle>
        </CardHeader>
        <CardContent>
          <AssociationTypeForm objects={objects} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Association types ({types.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {types.length === 0 ? (
            <p className="text-sm text-muted-foreground">None yet. Create one above — e.g. Company → Contact labelled “Employees” / “Employer”.</p>
          ) : (
            <ul className="divide-y divide-border">
              {types.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium">{labelOf(t.fromObject)}</span>
                    <span className="inline-flex items-center gap-1 text-muted-foreground">
                      <span className="rounded bg-secondary px-1.5 py-0.5 text-xs">{t.label}</span>
                      <ArrowRight className="h-3.5 w-3.5" />
                      <span className="rounded bg-secondary px-1.5 py-0.5 text-xs">{t.inverseLabel}</span>
                    </span>
                    <span className="font-medium">{labelOf(t.toObject)}</span>
                    <Badge variant="secondary">{CARDINALITY_LABEL[t.cardinality] ?? t.cardinality}</Badge>
                  </div>
                  <DeleteButton
                    action={deleteAssociationType.bind(null, t.id)}
                    label="Delete"
                    confirmText={`Delete "${t.label}"? All links of this type will be removed from every record.`}
                  />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
