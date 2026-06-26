import { requireAuth } from "@/lib/auth";
import { withTenant } from "@/lib/tenant";
import { createDeal } from "@/lib/actions/deals";
import { PageHeader } from "@/components/app/page-header";
import { DealForm } from "@/components/app/deal-form";
import { Card, CardContent } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function NewDealPage() {
  const ctx = await requireAuth();
  const { pipelines, companies } = await withTenant(ctx.workspaceId, async (tx) => {
    const pls = await tx.pipeline.findMany({
      orderBy: { position: "asc" },
      include: { stages: { orderBy: { position: "asc" }, select: { id: true, name: true } } },
    });
    const companies = await tx.company.findMany({
      where: { deletedAt: null },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });
    return {
      pipelines: pls.map((p) => ({ id: p.id, name: p.name, stages: p.stages })),
      companies,
    };
  });

  return (
    <div>
      <PageHeader title="New deal" description="Add a deal to your pipeline." />
      <Card>
        <CardContent className="pt-6">
          <DealForm action={createDeal} pipelines={pipelines} companies={companies} submitLabel="Create deal" />
        </CardContent>
      </Card>
    </div>
  );
}
