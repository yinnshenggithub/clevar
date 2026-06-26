import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { withTenant } from "@/lib/tenant";
import { updateContact, deleteContact } from "@/lib/actions/contacts";
import { PageHeader } from "@/components/app/page-header";
import { ContactForm } from "@/components/app/contact-form";
import { DeleteButton } from "@/components/app/delete-button";
import { Card, CardContent } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function ContactDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
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
    return { contact, companies };
  });

  if (!data) notFound();
  const { contact, companies } = data;
  const name = [contact.firstName, contact.lastName].filter(Boolean).join(" ") || "Unnamed contact";

  return (
    <div>
      <PageHeader
        title={name}
        description="Edit contact details."
        action={<DeleteButton action={deleteContact.bind(null, id)} label="Delete contact" />}
      />
      <Card>
        <CardContent className="pt-6">
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
    </div>
  );
}
