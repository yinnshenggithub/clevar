import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Table2 } from "lucide-react";
import { requireAuth, canManageWorkspace } from "@/lib/auth";
import { withTenant } from "@/lib/tenant";
import { deleteField, deleteObjectDefinition, updateObjectDefinition } from "@/lib/actions/objects";
import { FIELD_TYPE_LABELS, relationTarget, isRelationType, type FieldType } from "@/lib/custom-objects";
import { PageHeader } from "@/components/app/page-header";
import { FieldForm } from "@/components/app/field-form";
import { DeleteButton } from "@/components/app/delete-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

export default async function ManageObjectPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireAuth();
  if (!canManageWorkspace(ctx.role)) notFound();

  const data = await withTenant(ctx.workspaceId, async (tx) => {
    const def = await tx.objectDefinition.findFirst({
      where: { slug },
      include: { fields: { orderBy: { position: "asc" } } },
    });
    if (!def) return null;
    const others = await tx.objectDefinition.findMany({
      where: { slug: { not: slug } },
      select: { slug: true, nameSingular: true },
    });
    return { def, others };
  });
  if (!data) notFound();
  const { def, others } = data;

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title={def.namePlural}
        description="Manage this object's fields."
        action={
          <div className="flex items-center gap-2">
            <Link href="/app/objects">
              <Button variant="ghost" className="gap-2">
                <ArrowLeft className="h-4 w-4" /> Objects
              </Button>
            </Link>
            <Link href={`/app/o/${def.slug}`}>
              <Button variant="outline" className="gap-2">
                <Table2 className="h-4 w-4" /> Records
              </Button>
            </Link>
          </div>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Object name</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            action={updateObjectDefinition.bind(null, def.id)}
            className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
          >
            <div className="space-y-2">
              <Label htmlFor="nameSingular">Singular</Label>
              <Input id="nameSingular" name="nameSingular" defaultValue={def.nameSingular} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="namePlural">Plural</Label>
              <Input id="namePlural" name="namePlural" defaultValue={def.namePlural} required />
            </div>
            <Button type="submit">Rename</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Fields ({def.fields.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {def.fields.length > 0 && (
            <ul className="divide-y divide-border rounded-md border border-border">
              {def.fields.map((f) => {
                const rel = isRelationType(f.type) ? relationTarget(f.options) : null;
                return (
                  <li key={f.id} className="flex items-center justify-between px-3 py-2">
                    <div>
                      <span className="text-sm font-medium">{f.label}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        <Badge variant="secondary">{FIELD_TYPE_LABELS[f.type as FieldType] ?? f.type}</Badge>
                        {rel && <span className="ml-1">→ {rel}</span>}
                      </span>
                    </div>
                    <DeleteButton action={deleteField.bind(null, f.id, def.slug)} label="" confirmText={`Delete field "${f.label}"?`} />
                  </li>
                );
              })}
            </ul>
          )}
          <FieldForm token={def.slug} customTargets={others} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base text-destructive">Danger zone</CardTitle>
        </CardHeader>
        <CardContent>
          <DeleteButton
            action={deleteObjectDefinition.bind(null, def.id)}
            label={`Delete "${def.namePlural}" and all its records`}
            confirmText={`Delete the "${def.namePlural}" object and ALL its records? This cannot be undone.`}
          />
        </CardContent>
      </Card>
    </div>
  );
}
