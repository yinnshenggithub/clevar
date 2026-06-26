import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { withTenant } from "@/lib/tenant";
import { updateContact, deleteContact } from "@/lib/actions/contacts";
import { getLinkedRecords } from "@/lib/object-data";
import { PageHeader } from "@/components/app/page-header";
import { ContactForm } from "@/components/app/contact-form";
import { LinkedRecordsCard } from "@/components/app/linked-records-card";
import { RecordActivity } from "@/components/app/record-activity";
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
    const linked = await getLinkedRecords(tx, "contact", id);
    return { contact, companies, linked };
  });

  if (!data) notFound();
  const { contact, companies, linked } = data;
  const name = [contact.firstName, contact.lastName].filter(Boolean).join(" ") || "Unnamed contact";

  return (
    <div className="space-y-6">
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
      <LinkedRecordsCard linked={linked} />
      <RecordActivity parentType="CONTACT" parentId={id} />
    </div>
  );
}
