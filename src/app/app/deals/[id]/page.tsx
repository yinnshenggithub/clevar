import Link from "next/link";
import { notFound } from "next/navigation";
import { Handshake } from "lucide-react";
import { requireAuth } from "@/lib/auth";
import { withTenant } from "@/lib/tenant";
import { updateDeal, deleteDeal } from "@/lib/actions/deals";
import { getLinkedRecords, relationOptions } from "@/lib/object-data";
import { getAssociationsFor, availableAssociationTypes } from "@/lib/associations";
import { PageHeader } from "@/components/app/page-header";
import { DealForm } from "@/components/app/deal-form";
import { AssociationsPanel } from "@/components/app/associations-panel";
import { RecordActivity } from "@/components/app/record-activity";
import { RecordDetailLayout } from "@/components/app/record-detail-layout";
import { RecordIdentity, RecordHighlights } from "@/components/app/record-identity";
import { RelatedPanel, RelatedEmpty } from "@/components/app/related-panel";
import { FavoriteButton } from "@/components/app/favorite-button";
import { DeleteButton } from "@/components/app/delete-button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

const fmtDate = (d: Date) => d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
const contactName = (c: { firstName: string | null; lastName: string | null; email: string | null }) =>
  [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || "Unnamed";

function statusVariant(status: string): "default" | "success" | "destructive" {
  if (status === "WON") return "success";
  if (status === "LOST") return "destructive";
  return "default";
}

function money(amount: unknown, currency: string): string | null {
  if (amount == null) return null;
  const n = Number(amount);
  if (Number.isNaN(n)) return null;
  try {
    return n.toLocaleString(undefined, { style: "currency", currency: currency || "USD" });
  } catch {
    return `${currency} ${n.toLocaleString()}`;
  }
}

export default async function DealDetailPage({ params }: { params: Promise<{ id: string }> }) {
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
    const company = deal.companyId
      ? await tx.company.findFirst({ where: { id: deal.companyId }, select: { id: true, name: true } })
      : null;
    const contactRows = await tx.contact.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: 500,
      select: { id: true, firstName: true, lastName: true, email: true },
    });
    const dc = await tx.dealContact.findMany({ where: { dealId: id }, select: { contactId: true } });
    const dcIds = new Set(dc.map((x) => x.contactId));
    const linked = await getLinkedRecords(tx, "deal", id);
    const assocViews = await getAssociationsFor(tx, "deal", id);
    const addable = await Promise.all(
      (await availableAssociationTypes(tx, "deal")).map(async (a) => ({ ...a, options: await relationOptions(tx, a.otherObject) })),
    );
    const fav = await tx.favorite.findFirst({ where: { userId: ctx.userId, entityType: "deal", entityId: id } });
    return { deal, pls, companies, company, contactRows, dcIds, linked, assocViews, addable, fav: Boolean(fav) };
  });

  if (!data) notFound();
  const { deal, pls, companies, company, contactRows, dcIds, linked, assocViews, addable } = data;
  const pipelines = pls.map((p) => ({ id: p.id, name: p.name, stages: p.stages }));
  const stageName = pls.flatMap((p) => p.stages).find((s) => s.id === deal.stageId)?.name ?? "—";
  const pipelineName = pls.find((p) => p.id === deal.pipelineId)?.name ?? "—";
  const contacts = contactRows.map((c) => ({ id: c.id, label: contactName(c) }));
  const linkedContacts = contactRows.filter((c) => dcIds.has(c.id));
  const defaultContactIds = [...dcIds];

  return (
    <div className="space-y-6">
      <PageHeader
        title={deal.title}
        description="Deal record"
        action={
          <div className="flex items-center gap-2">
            <FavoriteButton entityType="deal" entityId={id} label={deal.title} href={`/app/deals/${id}`} initial={data.fav} />
            <DeleteButton action={deleteDeal.bind(null, id)} label="Delete deal" />
          </div>
        }
      />

      <RecordDetailLayout
        identity={
          <RecordIdentity
            icon={<Handshake className="h-6 w-6" />}
            title={deal.title}
            subtitle={money(deal.amount, deal.currency) || undefined}
            badge={<Badge variant={statusVariant(deal.status)}>{deal.status}</Badge>}
            facts={[
              { label: "Amount", value: money(deal.amount, deal.currency) },
              { label: "Pipeline", value: pipelineName },
              { label: "Stage", value: stageName },
              { label: "Company", value: company ? <Link href={`/app/companies/${company.id}`} className="text-primary hover:underline">{company.name}</Link> : null },
              { label: "Close date", value: deal.expectedCloseAt ? fmtDate(deal.expectedCloseAt) : null },
            ]}
          />
        }
        about={
          <Card>
            <CardHeader>
              <CardTitle className="text-base">About this deal</CardTitle>
            </CardHeader>
            <CardContent>
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
                  expectedCloseAt: deal.expectedCloseAt ? deal.expectedCloseAt.toISOString().slice(0, 10) : "",
                }}
                submitLabel="Save changes"
              />
            </CardContent>
          </Card>
        }
        tabs={[
          { key: "overview", label: "Overview" },
          { key: "activity", label: "Activity" },
        ]}
        panels={{
          overview: (
            <RecordHighlights
              items={[
                { label: "Created", value: fmtDate(deal.createdAt) },
                { label: "Stage", value: stageName },
                { label: "Amount", value: money(deal.amount, deal.currency) },
                { label: "Close date", value: deal.expectedCloseAt ? fmtDate(deal.expectedCloseAt) : null },
              ]}
            />
          ),
          activity: <RecordActivity parentType="DEAL" parentId={id} />,
        }}
        aside={
          <>
            <AssociationsPanel record={{ type: "deal", id }} views={assocViews} addable={addable} />
            <RelatedPanel title="Contacts" count={linkedContacts.length}>
              {linkedContacts.length === 0 ? (
                <RelatedEmpty>No contacts linked. Add them in “About this deal”.</RelatedEmpty>
              ) : (
                <ul className="divide-y divide-border">
                  {linkedContacts.map((c) => (
                    <li key={c.id} className="py-2">
                      <Link href={`/app/contacts/${c.id}`} className="text-sm font-medium hover:underline">{contactName(c)}</Link>
                    </li>
                  ))}
                </ul>
              )}
            </RelatedPanel>

            <RelatedPanel title="Company" count={company ? 1 : 0}>
              {company ? (
                <Link href={`/app/companies/${company.id}`} className="text-sm font-medium hover:underline">{company.name}</Link>
              ) : (
                <RelatedEmpty>No company linked.</RelatedEmpty>
              )}
            </RelatedPanel>

            {linked.length > 0 && (
              <RelatedPanel title="Linked records" count={linked.length}>
                <ul className="divide-y divide-border">
                  {linked.map((l) => (
                    <li key={l.recordId} className="flex items-center justify-between gap-2 py-2">
                      <Link href={`/app/o/${l.slug}/${l.recordId}`} className="text-sm font-medium hover:underline">{l.title}</Link>
                      <span className="shrink-0 text-xs text-muted-foreground">{l.nameSingular}</span>
                    </li>
                  ))}
                </ul>
              </RelatedPanel>
            )}
          </>
        }
      />
    </div>
  );
}
