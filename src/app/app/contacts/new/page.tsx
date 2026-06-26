import { requireAuth } from "@/lib/auth";
import { withTenant } from "@/lib/tenant";
import { createContact } from "@/lib/actions/contacts";
import { PageHeader } from "@/components/app/page-header";
import { ContactForm } from "@/components/app/contact-form";
import { Card, CardContent } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function NewContactPage() {
  const ctx = await requireAuth();
  const companies = await withTenant(ctx.workspaceId, (tx) =>
    tx.company.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  );

  return (
    <div>
      <PageHeader title="New contact" description="Add someone to your CRM." />
      <Card>
        <CardContent className="pt-6">
          <ContactForm action={createContact} companies={companies} submitLabel="Create contact" />
        </CardContent>
      </Card>
    </div>
  );
}
