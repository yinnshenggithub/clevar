import { requireAuth } from "@/lib/auth";
import { withTenant } from "@/lib/tenant";
import { createCompany } from "@/lib/actions/companies";
import { buildRecordFields } from "@/lib/object-data";
import { PageHeader } from "@/components/app/page-header";
import { CompanyForm } from "@/components/app/company-form";
import { Card, CardContent } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function NewCompanyPage() {
  const ctx = await requireAuth();
  const customFields = await withTenant(ctx.workspaceId, (tx) => buildRecordFields(tx, "company"));
  return (
    <div>
      <PageHeader title="New company" description="Add an account to your CRM." />
      <Card>
        <CardContent className="pt-6">
          <CompanyForm action={createCompany} customFields={customFields} submitLabel="Create company" />
        </CardContent>
      </Card>
    </div>
  );
}
