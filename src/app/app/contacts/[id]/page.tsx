import Link from "next/link";
import { notFound } from "next/navigation";
import { User } from "lucide-react";
import { requireAuth } from "@/lib/auth";
import { withTenant } from "@/lib/tenant";
import { updateContact, deleteContact } from "@/lib/actions/contacts";
import { getLinkedRecords } from "@/lib/object-data";
import { PageHeader } from "@/components/app/page-header";
import { ContactForm } from "@/components/app/contact-form";
import { RecordActivity } from "@/components/app/record-activity";
import { RecordDetailLayout } from "@/components/app/record-detail-layout";
import { RecordIdentity, RecordHighlights } from "@/components/app/record-identity";
import { RelatedPanel, RelatedEmpty } from "@/components/app/related-panel";
import { FavoriteButton } from "@/components/app/favorite-button";
import { DeleteButton } from "@/components/app/delete-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

const fmtDate = (d: Date) => d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

export default async function ContactDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireAuth();

  const data = await withTenant(ctx.workspaceId, async (tx) => {
    const contact = await tx.contact.findFirst({ where: { id, deletedAt: null } });
    if (!contact) return null;
    const companies = await tx.company.findMany({
      where: { deletedAt: null },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });
    const company = contact.companyId
      ? await tx.company.findFirst({ where: { id: contact.companyId }, select: { id: true, name: true } })
      : null;
    const dc = await tx.dealContact.findMany({ where: { contactId: id }, select: { dealId: true } });
    const deals = dc.length
      ? await tx.deal.findMany({
          where: { id: { in: dc.map((x) => x.dealId) }, deletedAt: null },
          orderBy: { createdAt: "desc" },
          select: { id: true, title: true, status: true },
        })
      : [];
    const linked = await getLinkedRecords(tx, "contact", id);
    const fav = await tx.favorite.findFirst({ where: { userId: ctx.userId, entityType: "contact", entityId: id } });
    return { contact, companies, company, deals, linked, fav: Boolean(fav) };
  });

  if (!data) notFound();
  const { contact, companies, company, deals, linked } = data;
  const name = [contact.firstName, contact.lastName].filter(Boolean).join(" ") || "Unnamed contact";

  return (
    <div className="space-y-6">
      <PageHeader
        title={name}
        description="Contact record"
        action={
          <div className="flex items-center gap-2">
            <FavoriteButton entityType="contact" entityId={id} label={name} href={`/app/contacts/${id}`} initial={data.fav} />
            <DeleteButton action={deleteContact.bind(null, id)} label="Delete contact" />
          </div>
        }
      />

      <RecordDetailLayout
        identity={
          <RecordIdentity
            icon={<User className="h-6 w-6" />}
            title={name}
            subtitle={contact.email || contact.phone || undefined}
            facts={[
              { label: "Email", value: contact.email },
              { label: "Phone", value: contact.phone },
              { label: "Job title", value: contact.jobTitle },
              { label: "Company", value: company ? <Link href={`/app/companies/${company.id}`} className="text-primary hover:underline">{company.name}</Link> : null },
            ]}
          />
        }
        about={
          <Card>
            <CardHeader>
              <CardTitle className="text-base">About this contact</CardTitle>
            </CardHeader>
            <CardContent>
              <ContactForm
                action={updateContact.bind(null, id)}
                companies={companies}
                defaults={{
                  firstName: contact.firstName,
                  lastName: contact.lastName,
                  email: contact.email,
                  phone: contact.phone,
                  jobTitle: contact.jobTitle,
                  companyId: contact.companyId,
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
                { label: "Created", value: fmtDate(contact.createdAt) },
                { label: "Company", value: company?.name },
                { label: "Open deals", value: deals.filter((d) => d.status === "OPEN").length },
              ]}
            />
          ),
          activity: <RecordActivity parentType="CONTACT" parentId={id} />,
        }}
        aside={
          <>
            <RelatedPanel title="Company" count={company ? 1 : 0}>
              {company ? (
                <Link href={`/app/companies/${company.id}`} className="text-sm font-medium hover:underline">
                  {company.name}
                </Link>
              ) : (
                <RelatedEmpty>Not linked to a company yet.</RelatedEmpty>
              )}
            </RelatedPanel>

            <RelatedPanel title="Deals" count={deals.length}>
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
