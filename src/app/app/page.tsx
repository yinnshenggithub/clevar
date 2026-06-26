import Link from "next/link";
import { Users, Building2, CircleDollarSign, TrendingUp } from "lucide-react";
import { requireAuth } from "@/lib/auth";
import { withTenant } from "@/lib/tenant";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";

export default async function DashboardPage() {
  const ctx = await requireAuth();

  const data = await withTenant(ctx.workspaceId, async (tx) => {
    const [contacts, companies, openDeals, openValue, recentContacts] = await Promise.all([
      tx.contact.count({ where: { deletedAt: null } }),
      tx.company.count({ where: { deletedAt: null } }),
      tx.deal.count({ where: { deletedAt: null, status: "OPEN" } }),
      tx.deal.aggregate({ _sum: { amount: true }, where: { deletedAt: null, status: "OPEN" } }),
      tx.contact.findMany({
        where: { deletedAt: null },
        orderBy: { createdAt: "desc" },
        take: 5,
        include: { company: { select: { name: true } } },
      }),
    ]);
    return {
      contacts,
      companies,
      openDeals,
      openValue: openValue._sum.amount ? Number(openValue._sum.amount) : 0,
      recentContacts,
    };
  });

  const stats = [
    { label: "Contacts", value: data.contacts.toString(), icon: Users, href: "/app/contacts" },
    { label: "Companies", value: data.companies.toString(), icon: Building2, href: "/app/companies" },
    { label: "Open deals", value: data.openDeals.toString(), icon: CircleDollarSign, href: "/app/deals" },
    { label: "Open pipeline", value: formatCurrency(data.openValue), icon: TrendingUp, href: "/app/deals" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Welcome back, {ctx.user.fullName.split(" ")[0]}
        </h1>
        <p className="text-sm text-muted-foreground">Here&apos;s what&apos;s happening in {ctx.workspace.name}.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <Link key={s.label} href={s.href}>
            <Card className="transition-colors hover:border-primary/40">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">{s.label}</CardTitle>
                <s.icon className="h-4 w-4 text-primary" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{s.value}</div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent contacts</CardTitle>
        </CardHeader>
        <CardContent>
          {data.recentContacts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No contacts yet.{" "}
              <Link href="/app/contacts/new" className="text-primary hover:underline">
                Add your first contact
              </Link>
              .
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {data.recentContacts.map((c) => (
                <li key={c.id} className="flex items-center justify-between py-2.5">
                  <Link href={`/app/contacts/${c.id}`} className="font-medium hover:underline">
                    {[c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || "Unnamed contact"}
                  </Link>
                  <span className="text-sm text-muted-foreground">{c.company?.name ?? "—"}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
