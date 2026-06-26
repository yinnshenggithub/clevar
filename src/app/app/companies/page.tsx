import Link from "next/link";
import { Plus, Building2 } from "lucide-react";
import { requireAuth } from "@/lib/auth";
import { withTenant } from "@/lib/tenant";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function CompaniesPage() {
  const ctx = await requireAuth();
  const companies = await withTenant(ctx.workspaceId, (tx) =>
    tx.company.findMany({
      where: { deletedAt: null },
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
          <Link href="/app/companies/new">
            <Button className="gap-2">
              <Plus className="h-4 w-4" /> New company
            </Button>
          </Link>
        }
      />

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
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-secondary/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Domain</th>
                <th className="px-4 py-3 font-medium">Industry</th>
                <th className="px-4 py-3 font-medium">Contacts</th>
                <th className="px-4 py-3 font-medium">Deals</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {companies.map((c) => (
                <tr key={c.id} className="hover:bg-accent/40">
                  <td className="px-4 py-3">
                    <Link href={`/app/companies/${c.id}`} className="font-medium hover:underline">
                      {c.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{c.domain ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{c.industry ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{c._count.contacts}</td>
                  <td className="px-4 py-3 text-muted-foreground">{c._count.deals}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
