import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { withTenant } from "@/lib/tenant";
import { updateDeal, deleteDeal } from "@/lib/actions/deals";
import { getLinkedRecords } from "@/lib/object-data";
import { PageHeader } from "@/components/app/page-header";
import { DealForm } from "@/components/app/deal-form";
import { LinkedRecordsCard } from "@/components/app/linked-records-card";
import { DeleteButton } from "@/components/app/delete-button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

export const dynamic = "force-dynamic";

function statusVariant(status: string): "default" | "success" | "destructive" {
  if (status === "WON") return "success";
  if (status === "LOST") return "destructive";
  return "default";
}

export default async function DealDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireAuth();

  const data = await withTenant(ctx.workspaceId, async (tx) => {
    const deal = await tx.deal.findFirst({ where: { id, deletedAt: null } });
    if (!deal) return null;
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
      select: { id: true, firstName: true, lastName: true, email: true },
    });
    const dc = await tx.dealContact.findMany({ where: { dealId: id }, select: { contactId: true } });
    const linked = await getLinkedRecords(tx, "deal", id);
    return {
      deal,
      pipelines: pls.map((p) => ({ id: p.id, name: p.name, stages: p.stages })),
      companies,
      contacts: contactRows.map((c) => ({
        id: c.id,
        label: [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || "Unnamed",
      })),
      defaultContactIds: dc.map((x) => x.contactId),
      linked,
    };
  });

  if (!data) notFound();
  const { deal, pipelines, companies, contacts, defaultContactIds, linked } = data;

  return (
    <div className="space-y-6">
      <PageHeader
        title={deal.title}
        description="Edit deal details."
        action={<DeleteButton action={deleteDeal.bind(null, id)} label="Delete deal" />}
      />
      <div className="mb-4">
        <Badge variant={statusVariant(deal.status)}>{deal.status}</Badge>
      </div>
      <Card>
        <CardContent className="pt-6">
          <DealForm
            action={updateDeal.bind(null, id)}
            pipelines={pipelines}
            companies={companies}
            contacts={contacts}
            defaultContactIds={defaultContactIds}
            defaults={{
              title: deal.title,
              amount: deal.amount ? Number(deal.amount).toString() : "",
              currency: deal.currency,
              pipelineId: deal.pipelineId,
              stageId: deal.stageId,
              companyId: deal.companyId,
              expectedCloseAt: deal.expectedCloseAt
                ? deal.expectedCloseAt.toISOString().slice(0, 10)
                : "",
            }}
            submitLabel="Save changes"
          />
        </CardContent>
      </Card>
      <LinkedRecordsCard linked={linked} />
    </div>
  );
}
