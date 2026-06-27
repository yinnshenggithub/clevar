import Link from "next/link";
import { notFound } from "next/navigation";
import { Plus, X, Building2 } from "lucide-react";
import { requireAuth } from "@/lib/auth";
import { withTenant } from "@/lib/tenant";
import {
  updateCompany,
  deleteCompany,
  addContactToCompany,
  removeContactFromCompany,
} from "@/lib/actions/companies";
import { getLinkedRecords, relationOptions, buildRecordFields } from "@/lib/object-data";
import { getAssociationsFor, availableAssociationTypes } from "@/lib/associations";
import { PageHeader } from "@/components/app/page-header";
import { CompanyForm } from "@/components/app/company-form";
import { AssociationsPanel } from "@/components/app/associations-panel";
import { RecordActivity } from "@/components/app/record-activity";
import { RecordDetailLayout } from "@/components/app/record-detail-layout";
import { RecordIdentity, RecordHighlights } from "@/components/app/record-identity";
import { RelatedPanel, RelatedEmpty } from "@/components/app/related-panel";
import { FavoriteButton } from "@/components/app/favorite-button";
import { DeleteButton } from "@/components/app/delete-button";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

const fmtDate = (d: Date) => d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
const contactName = (c: { firstName: string | null; lastName: string | null; email: string | null }) =>
  [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || "Unnamed";

export default async function CompanyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireAuth();

  const data = await withTenant(ctx.workspaceId, async (tx) => {
    const company = await tx.company.findFirst({ where: { id, deletedAt: null } });
    if (!company) return null;
    const [contacts, deals, available] = await Promise.all([
      tx.contact.findMany({ where: { companyId: id, deletedAt: null }, orderBy: { createdAt: "desc" }, take: 100 }),
      tx.deal.findMany({ where: { companyId: id, deletedAt: null }, orderBy: { createdAt: "desc" }, take: 100 }),
      tx.contact.findMany({
        where: { deletedAt: null, NOT: { companyId: id } },
        orderBy: { createdAt: "desc" },
        take: 500,
        select: { id: true, firstName: true, lastName: true, email: true },
      }),
    ]);
    const linked = await getLinkedRecords(tx, "company", id);
    const assocViews = await getAssociationsFor(tx, "company", id);
    const addable = await Promise.all(
      (await availableAssociationTypes(tx, "company")).map(async (a) => ({ ...a, options: await relationOptions(tx, a.otherObject) })),
    );
    const fav = await tx.favorite.findFirst({ where: { userId: ctx.userId, entityType: "company", entityId: id } });
    const customFields = await buildRecordFields(tx, "company");
    return { company, contacts, deals, available, linked, assocViews, addable, customFields, fav: Boolean(fav) };
  });

  if (!data) notFound();
  const { company, contacts, deals, available, linked, assocViews, addable, customFields } = data;

  return (
    <div className="space-y-6">
      <PageHeader
        title={company.name}
        description="Company record"
        action={
          <div className="flex items-center gap-2">
            <FavoriteButton entityType="company" entityId={id} label={company.name} href={`/app/companies/${id}`} initial={data.fav} />
            <Link href={`/app/deals/new?companyId=${id}`}>
              <Button variant="outline" className="gap-2"><Plus className="h-4 w-4" /> New deal</Button>
            </Link>
            <DeleteButton action={deleteCompany.bind(null, id)} label="Delete company" />
          </div>
        }
      />

      <RecordDetailLayout
        identity={
          <RecordIdentity
            icon={<Building2 className="h-6 w-6" />}
            title={company.name}
            subtitle={company.domain || undefined}
            facts={[
              { label: "Domain", value: company.domain },
              { label: "Industry", value: company.industry },
              { label: "Contacts", value: contacts.length },
              { label: "Deals", value: deals.length },
            ]}
          />
        }
        about={
          <Card>
            <CardHeader>
              <CardTitle className="text-base">About this company</CardTitle>
            </CardHeader>
            <CardContent>
              <CompanyForm
                action={updateCompany.bind(null, id)}
                defaults={{ name: company.name, domain: company.domain, industry: company.industry }}
                customFields={customFields}
                customFieldDefaults={company.customFields as Record<string, unknown>}
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
                { label: "Created", value: fmtDate(company.createdAt) },
                { label: "Contacts", value: contacts.length },
                { label: "Open deals", value: deals.filter((d) => d.status === "OPEN").length },
              ]}
            />
          ),
          activity: <RecordActivity parentType="COMPANY" parentId={id} />,
        }}
        aside={
          <>
            <AssociationsPanel record={{ type: "company", id }} views={assocViews} addable={addable} />
            <RelatedPanel title="Contacts" count={contacts.length}>
              <div className="space-y-3">
                {contacts.length > 0 && (
                  <ul className="divide-y divide-border">
                    {contacts.map((c) => (
                      <li key={c.id} className="flex items-center justify-between py-2">
                        <Link href={`/app/contacts/${c.id}`} className="text-sm font-medium hover:underline">{contactName(c)}</Link>
                        <form action={removeContactFromCompany.bind(null, id, c.id)}>
                          <button type="submit" className="text-muted-foreground hover:text-destructive" aria-label="Remove from company">
                            <X className="h-4 w-4" />
                          </button>
                        </form>
                      </li>
                    ))}
                  </ul>
                )}
                <form action={addContactToCompany.bind(null, id)} className="flex gap-2">
                  <Select name="contactId" className="flex-1" defaultValue="" aria-label="Add existing contact">
                    <option value="">Add existing contact…</option>
                    {available.map((c) => (
                      <option key={c.id} value={c.id}>{contactName(c)}</option>
                    ))}
                  </Select>
                  <Button type="submit" variant="outline" size="sm">Add</Button>
                </form>
              </div>
            </RelatedPanel>

            <RelatedPanel
              title="Deals"
              count={deals.length}
              action={
                <Link href={`/app/deals/new?companyId=${id}`} className="text-sm font-medium text-primary hover:underline">+ Add</Link>
              }
            >
              {deals.length === 0 ? (
                <RelatedEmpty>No deals linked.</RelatedEmpty>
              ) : (
                <ul className="divide-y divide-border">
                  {deals.map((d) => (
                    <li key={d.id} className="py-2">
                      <Link href={`/app/deals/${d.id}`} className="text-sm font-medium hover:underline">{d.title}</Link>
                    </li>
                  ))}
                </ul>
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
