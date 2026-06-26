import Link from "next/link";
import { Plus, Building2, Upload, Download } from "lucide-react";
import { requireAuth } from "@/lib/auth";
import { withTenant } from "@/lib/tenant";
import { bulkDeleteCompanies } from "@/lib/actions/companies";
import { PageHeader } from "@/components/app/page-header";
import { SearchBar } from "@/components/app/search-bar";
import { BulkTable } from "@/components/app/bulk-table";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function CompaniesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const ctx = await requireAuth();
  const query = ((await searchParams).q ?? "").trim();
  const companies = await withTenant(ctx.workspaceId, (tx) =>
    tx.company.findMany({
      where: {
        deletedAt: null,
        ...(query
          ? {
              OR: [
                { name: { contains: query, mode: "insensitive" } },
                { domain: { contains: query, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { contacts: true, deals: true } } },
      take: 200,
    }),
  );

  return (
    <div>
      <PageHeader
        title="Companies"
        description="The accounts in your pipeline."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <a href="/api/export?object=companies">
              <Button variant="outline" className="gap-2">
                <Download className="h-4 w-4" /> Export
              </Button>
            </a>
            <Link href="/app/import/companies">
              <Button variant="outline" className="gap-2">
                <Upload className="h-4 w-4" /> Import
              </Button>
            </Link>
            <Link href="/app/companies/new">
              <Button className="gap-2">
                <Plus className="h-4 w-4" /> New company
              </Button>
            </Link>
          </div>
        }
      />

      <SearchBar placeholder="Search companies…" defaultValue={query} />

      {companies.length === 0 ? (
        <Card className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <Building2 className="h-10 w-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No companies yet.</p>
          <Link href="/app/companies/new">
            <Button className="gap-2">
              <Plus className="h-4 w-4" /> Add your first company
            </Button>
          </Link>
        </Card>
      ) : (
        <BulkTable
          noun="company"
          columns={["Name", "Domain", "Industry", "Contacts", "Deals"]}
          deleteAction={bulkDeleteCompanies}
          rows={companies.map((c) => ({
            id: c.id,
            cells: [
              <Link key="n" href={`/app/companies/${c.id}`} className="font-medium hover:underline">{c.name}</Link>,
              <span key="d" className="text-muted-foreground">{c.domain ?? "—"}</span>,
              <span key="i" className="text-muted-foreground">{c.industry ?? "—"}</span>,
              <span key="ct" className="text-muted-foreground">{c._count.contacts}</span>,
              <span key="dl" className="text-muted-foreground">{c._count.deals}</span>,
            ],
          }))}
        />
      )}
    </div>
  );
}
