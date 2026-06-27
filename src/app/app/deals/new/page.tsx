import { requireAuth } from "@/lib/auth";
import { withTenant } from "@/lib/tenant";
import { createDeal } from "@/lib/actions/deals";
import { buildRecordFields } from "@/lib/object-data";
import { PageHeader } from "@/components/app/page-header";
import { DealForm } from "@/components/app/deal-form";
import { Card, CardContent } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function NewDealPage({
  searchParams,
}: {
  searchParams: Promise<{ companyId?: string }>;
}) {
  const ctx = await requireAuth();
  const { companyId } = await searchParams;

  const data = await withTenant(ctx.workspaceId, async (tx) => {
    const pls = await tx.pipeline.findMany({
      orderBy: { position: "asc" },
      include: { stages: { orderBy: { position: "asc" }, select: { id: true, name: true } } },
    });
    const companies = await tx.company.findMany({
      where: { deletedAt: null },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });
    const contactRows = await tx.contact.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: 500,
      select: { id: true, firstName: true, lastName: true, email: true, companyId: true },
    });
    const contacts = contactRows.map((c) => ({
      id: c.id,
      label: [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || "Unnamed",
    }));
    // When opened from a company, auto-select that company's contacts.
    const defaultContactIds = companyId ? contactRows.filter((c) => c.companyId === companyId).map((c) => c.id) : [];
    const customFields = await buildRecordFields(tx, "deal");
    return {
      pipelines: pls.map((p) => ({ id: p.id, name: p.name, stages: p.stages })),
      companies,
      contacts,
      defaultContactIds,
      customFields,
    };
  });

  return (
    <div>
      <PageHeader title="New deal" description="Add a deal and associate a company + contacts." />
      <Card>
        <CardContent className="pt-6">
          <DealForm
            action={createDeal}
            pipelines={data.pipelines}
            companies={data.companies}
            contacts={data.contacts}
            defaultContactIds={data.defaultContactIds}
            defaults={companyId ? { companyId } : undefined}
            customFields={data.customFields}
            submitLabel="Create deal"
          />
        </CardContent>
      </Card>
    </div>
  );
}
