import Link from "next/link";
import { notFound } from "next/navigation";
import { Plus, X } from "lucide-react";
import { requireAuth } from "@/lib/auth";
import { withTenant } from "@/lib/tenant";
import {
  updateCompany,
  deleteCompany,
  addContactToCompany,
  removeContactFromCompany,
} from "@/lib/actions/companies";
import { getLinkedRecords } from "@/lib/object-data";
import { PageHeader } from "@/components/app/page-header";
import { CompanyForm } from "@/components/app/company-form";
import { LinkedRecordsCard } from "@/components/app/linked-records-card";
import { RecordActivity } from "@/components/app/record-activity";
import { FavoriteButton } from "@/components/app/favorite-button";
import { DeleteButton } from "@/components/app/delete-button";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

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
    const fav = await tx.favorite.findFirst({ where: { userId: ctx.userId, entityType: "company", entityId: id } });
    return { company, contacts, deals, available, linked, fav: Boolean(fav) };
  });

  if (!data) notFound();
  const { company, contacts, deals, available, linked } = data;

  return (
    <div className="space-y-6">
      <PageHeader
        title={company.name}
        description="Edit company details."
        action={
          <div className="flex items-center gap-2">
            <FavoriteButton entityType="company" entityId={id} label={company.name} href={`/app/companies/${id}`} initial={data.fav} />
            <Link href={`/app/deals/new?companyId=${id}`}>
              <Button variant="outline" className="gap-2">
                <Plus className="h-4 w-4" /> New deal
              </Button>
            </Link>
            <DeleteButton action={deleteCompany.bind(null, id)} label="Delete company" />
          </div>
        }
      />
      <Card>
        <CardContent className="pt-6">
          <CompanyForm
            action={updateCompany.bind(null, id)}
            defaults={{ name: company.name, domain: company.domain, industry: company.industry }}
            submitLabel="Save changes"
          />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Contacts ({contacts.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {contacts.length > 0 && (
              <ul className="divide-y divide-border">
                {contacts.map((c) => (
                  <li key={c.id} className="flex items-center justify-between py-2">
                    <Link href={`/app/contacts/${c.id}`} className="text-sm font-medium hover:underline">
                      {contactName(c)}
                    </Link>
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
                  <option key={c.id} value={c.id}>
                    {contactName(c)}
                  </option>
                ))}
              </Select>
              <Button type="submit" variant="outline" size="sm">
                Add
              </Button>
            </form>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Deals ({deals.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {deals.length === 0 ? (
              <p className="text-sm text-muted-foreground">No deals linked.</p>
            ) : (
              <ul className="divide-y divide-border">
                {deals.map((d) => (
                  <li key={d.id} className="py-2">
                    <Link href={`/app/deals/${d.id}`} className="text-sm font-medium hover:underline">
                      {d.title}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
      <LinkedRecordsCard linked={linked} />
      <RecordActivity parentType="COMPANY" parentId={id} />
    </div>
  );
}
