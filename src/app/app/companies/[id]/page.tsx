import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { withTenant } from "@/lib/tenant";
import { updateCompany, deleteCompany } from "@/lib/actions/companies";
import { getLinkedRecords } from "@/lib/object-data";
import { PageHeader } from "@/components/app/page-header";
import { CompanyForm } from "@/components/app/company-form";
import { LinkedRecordsCard } from "@/components/app/linked-records-card";
import { DeleteButton } from "@/components/app/delete-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function CompanyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireAuth();

  const data = await withTenant(ctx.workspaceId, async (tx) => {
    const company = await tx.company.findFirst({ where: { id, deletedAt: null } });
    if (!company) return null;
    const [contacts, deals] = await Promise.all([
      tx.contact.findMany({
        where: { companyId: id, deletedAt: null },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
      tx.deal.findMany({
        where: { companyId: id, deletedAt: null },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
    ]);
    const linked = await getLinkedRecords(tx, "company", id);
    return { company, contacts, deals, linked };
  });

  if (!data) notFound();
  const { company, contacts, deals, linked } = data;

  return (
    <div className="space-y-6">
      <PageHeader
        title={company.name}
        description="Edit company details."
        action={<DeleteButton action={deleteCompany.bind(null, id)} label="Delete company" />}
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
            <CardTitle className="text-base">Contacts</CardTitle>
          </CardHeader>
          <CardContent>
            {contacts.length === 0 ? (
              <p className="text-sm text-muted-foreground">No contacts linked.</p>
            ) : (
              <ul className="divide-y divide-border">
                {contacts.map((c) => (
                  <li key={c.id} className="py-2">
                    <Link href={`/app/contacts/${c.id}`} className="text-sm font-medium hover:underline">
                      {[c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || "Unnamed"}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Deals</CardTitle>
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
    </div>
  );
}
