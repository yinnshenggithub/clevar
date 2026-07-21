import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowUp, ArrowDown, Boxes, Lock, Plus } from "lucide-react";
import { requireAuth, canManageWorkspace } from "@/lib/auth";
import { withTenant } from "@/lib/tenant";
import { deleteField, reorderField } from "@/lib/actions/objects";
import { listObjects, listFields, listBuiltinFields, type FieldDefRow, type BuiltinField, type ObjectMeta } from "@/lib/objects-registry";
import { FIELD_TYPE_LABELS, relationTarget, isRelationType, type FieldType } from "@/lib/custom-objects";
import { PageHeader } from "@/components/app/page-header";
import { FieldForm } from "@/components/app/field-form";
import { DeleteButton } from "@/components/app/delete-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

function typeLabel(type: string): string {
  return FIELD_TYPE_LABELS[type as FieldType] ?? type;
}

export default async function AllPropertiesSettingsPage() {
  const ctx = await requireAuth();
  if (!canManageWorkspace(ctx.role)) notFound();

  const { objects, fieldsByToken, customSlugs } = await withTenant(ctx.workspaceId, async (tx) => {
    const objects = await listObjects(tx);
    const fieldsByToken: Record<string, FieldDefRow[]> = {};
    for (const o of objects) fieldsByToken[o.token] = await listFields(tx, o.token);
    const customSlugs = objects.filter((o) => o.kind === "custom").map((o) => ({ slug: o.token, nameSingular: o.label }));
    return { objects, fieldsByToken, customSlugs };
  });

  const totalCustom = Object.values(fieldsByToken).reduce((n, f) => n + f.length, 0);

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader
        title="All properties"
        description={`Every object and its properties in one place. ${totalCustom} custom ${totalCustom === 1 ? "property" : "properties"} across ${objects.length} objects.`}
        action={
          <div className="flex items-center gap-2">
            <Link href="/app/settings/properties">
              <Button variant="ghost" className="gap-2">
                <ArrowLeft className="h-4 w-4" /> Single object
              </Button>
            </Link>
            <Link href="/app/objects">
              <Button variant="outline" className="gap-2">
                <Boxes className="h-4 w-4" /> Objects
              </Button>
            </Link>
          </div>
        }
      />

      {objects.map((obj) => (
        <ObjectSection
          key={obj.token}
          obj={obj}
          builtins={listBuiltinFields(obj.token)}
          fields={fieldsByToken[obj.token] ?? []}
          customTargets={customSlugs.filter((c) => c.slug !== obj.token)}
        />
      ))}
    </div>
  );
}

function ObjectSection({
  obj,
  builtins,
  fields,
  customTargets,
}: {
  obj: ObjectMeta;
  builtins: BuiltinField[];
  fields: FieldDefRow[];
  customTargets: { slug: string; nameSingular: string }[];
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">
          {obj.pluralLabel}
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            {builtins.length} built-in · {fields.length} custom
          </span>
        </CardTitle>
        <Badge variant="secondary">{obj.kind === "core" ? "Built-in" : "Custom"} object</Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="divide-y divide-border rounded-md border border-border">
          {builtins.map((f) => (
            <li key={f.key} className="flex items-center justify-between gap-2 px-3 py-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">
                  {f.label}
                  {f.required && <span className="ml-1 text-destructive">*</span>}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  <Badge variant="secondary">{typeLabel(f.type)}</Badge>
                  {f.target && <span className="ml-1">→ {f.target}</span>}
                </div>
              </div>
              <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                <Lock className="h-3.5 w-3.5" /> Built-in
              </span>
            </li>
          ))}
          {fields.map((f, i) => {
            const rel = isRelationType(f.type) ? relationTarget(f.options) : null;
            return (
              <li key={f.id} className="flex items-center justify-between gap-2 px-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">
                    {f.label}
                    {f.required && <span className="ml-1 text-destructive">*</span>}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    <Badge variant="secondary">{typeLabel(f.type)}</Badge>
                    {rel && <span className="ml-1">→ {rel}</span>}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <form action={reorderField.bind(null, f.id, obj.token, "up")}>
                    <button type="submit" disabled={i === 0} className="rounded p-1 text-muted-foreground hover:bg-accent disabled:opacity-30" aria-label="Move up">
                      <ArrowUp className="h-4 w-4" />
                    </button>
                  </form>
                  <form action={reorderField.bind(null, f.id, obj.token, "down")}>
                    <button type="submit" disabled={i === fields.length - 1} className="rounded p-1 text-muted-foreground hover:bg-accent disabled:opacity-30" aria-label="Move down">
                      <ArrowDown className="h-4 w-4" />
                    </button>
                  </form>
                  <DeleteButton action={deleteField.bind(null, f.id, obj.token)} label="" confirmText={`Delete property "${f.label}"?`} />
                </div>
              </li>
            );
          })}
        </ul>

        <details className="rounded-md border border-border">
          <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground">
            <Plus className="h-4 w-4" /> Add property to {obj.label}
          </summary>
          <div className="border-t border-border p-3">
            <FieldForm token={obj.token} customTargets={customTargets} />
          </div>
        </details>
      </CardContent>
    </Card>
  );
}
