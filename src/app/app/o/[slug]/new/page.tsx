import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { withTenant } from "@/lib/tenant";
import { createRecord } from "@/lib/actions/objects";
import { relationOptions } from "@/lib/object-data";
import { relationTarget, selectChoices } from "@/lib/custom-objects";
import { PageHeader } from "@/components/app/page-header";
import { RecordForm } from "@/components/app/record-form";
import { Card, CardContent } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function NewRecordPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireAuth();

  const data = await withTenant(ctx.workspaceId, async (tx) => {
    const def = await tx.objectDefinition.findFirst({
      where: { slug },
      include: { fields: { orderBy: { position: "asc" } } },
    });
    if (!def) return null;
    const fields = await Promise.all(
      def.fields.map(async (f) => ({
        key: f.key,
        label: f.label,
        type: f.type,
        choices: selectChoices(f.options),
        relOptions:
          f.type === "relation" && relationTarget(f.options)
            ? await relationOptions(tx, relationTarget(f.options)!)
            : [],
      })),
    );
    return { def, fields };
  });
  if (!data) notFound();

  return (
    <div>
      <PageHeader title={`New ${data.def.nameSingular.toLowerCase()}`} description={data.def.namePlural} />
      <Card>
        <CardContent className="pt-6">
          <RecordForm action={createRecord.bind(null, slug)} fields={data.fields} submitLabel={`Create ${data.def.nameSingular.toLowerCase()}`} />
        </CardContent>
      </Card>
    </div>
  );
}
