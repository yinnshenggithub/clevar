import { requireAuth } from "@/lib/auth";
import { createCompany } from "@/lib/actions/companies";
import { PageHeader } from "@/components/app/page-header";
import { CompanyForm } from "@/components/app/company-form";
import { Card, CardContent } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function NewCompanyPage() {
  await requireAuth();
  return (
    <div>
      <PageHeader title="New company" description="Add an account to your CRM." />
      <Card>
        <CardContent className="pt-6">
          <CompanyForm action={createCompany} submitLabel="Create company" />
        </CardContent>
      </Card>
    </div>
  );
}
