import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { withTenant } from "@/lib/tenant";
import { updateRecord, deleteRecord } from "@/lib/actions/objects";
import { relationOptions, getLinkedRecords } from "@/lib/object-data";
import { getAssociationsFor, availableAssociationTypes } from "@/lib/associations";
import { relationTarget, selectChoices, recordTitle, isRelationType, type FieldDefLite } from "@/lib/custom-objects";
import { PageHeader } from "@/components/app/page-header";
import { RecordForm } from "@/components/app/record-form";
import { LinkedRecordsCard } from "@/components/app/linked-records-card";
import { AssociationsPanel } from "@/components/app/associations-panel";
import { DeleteButton } from "@/components/app/delete-button";
import { Card, CardContent } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function EditRecordPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;
  const ctx = await requireAuth();

  const data = await withTenant(ctx.workspaceId, async (tx) => {
    const def = await tx.objectDefinition.findFirst({
      where: { slug },
      include: { fields: { orderBy: { position: "asc" } } },
    });
    if (!def) return null;
    const record = await tx.customRecord.findFirst({ where: { id, objectDefinitionId: def.id, deletedAt: null } });
    if (!record) return null;
    const fields = await Promise.all(
      def.fields.map(async (f) => ({
        key: f.key,
        label: f.label,
        type: f.type,
        required: f.required,
        defaultValue: f.defaultValue,
        choices: selectChoices(f.options),
        relOptions:
          isRelationType(f.type) && relationTarget(f.options)
            ? await relationOptions(tx, relationTarget(f.options)!)
            : [],
      })),
    );
    const linked = await getLinkedRecords(tx, slug, id);
    const assocViews = await getAssociationsFor(tx, slug, id);
    const addable = await Promise.all(
      (await availableAssociationTypes(tx, slug)).map(async (a) => ({ ...a, options: await relationOptions(tx, a.otherObject) })),
    );
    return { def, record, fields, linked, assocViews, addable };
  });
  if (!data) notFound();

  const title = recordTitle(data.def.fields as FieldDefLite[], data.record.values as Record<string, unknown>);

  return (
    <div className="space-y-6">
      <PageHeader
        title={title}
        description={`Edit ${data.def.nameSingular.toLowerCase()}`}
        action={<DeleteButton action={deleteRecord.bind(null, slug, id)} label={`Delete ${data.def.nameSingular.toLowerCase()}`} />}
      />
      <Card>
        <CardContent className="pt-6">
          <RecordForm
            action={updateRecord.bind(null, slug, id)}
            fields={data.fields}
            defaults={data.record.values as Record<string, unknown>}
            submitLabel="Save changes"
          />
        </CardContent>
      </Card>
      <LinkedRecordsCard linked={data.linked} />
      <AssociationsPanel record={{ type: slug, id }} views={data.assocViews} addable={data.addable} />
    </div>
  );
}
