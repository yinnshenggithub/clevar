import Link from "next/link";
import { Plus, Users, Upload, Download } from "lucide-react";
import { requireAuth } from "@/lib/auth";
import { withTenant } from "@/lib/tenant";
import { bulkDeleteContacts } from "@/lib/actions/contacts";
import { PageHeader } from "@/components/app/page-header";
import { SearchBar } from "@/components/app/search-bar";
import { BulkTable } from "@/components/app/bulk-table";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatPhone } from "@/lib/phone";

export const dynamic = "force-dynamic";

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const ctx = await requireAuth();
  const query = ((await searchParams).q ?? "").trim();
  const contacts = await withTenant(ctx.workspaceId, (tx) =>
    tx.contact.findMany({
      where: {
        deletedAt: null,
        ...(query
          ? {
              OR: [
                { firstName: { contains: query, mode: "insensitive" } },
                { lastName: { contains: query, mode: "insensitive" } },
                { email: { contains: query, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      include: { company: { select: { name: true } } },
      take: 200,
    }),
  );

  return (
    <div>
      <PageHeader
        title="Contacts"
        description="Everyone your team is in touch with."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <a href="/api/export?object=contacts">
              <Button variant="outline" className="gap-2">
                <Download className="h-4 w-4" /> Export
              </Button>
            </a>
            <Link href="/app/import/contacts">
              <Button variant="outline" className="gap-2">
                <Upload className="h-4 w-4" /> Import
              </Button>
            </Link>
            <Link href="/app/contacts/new">
              <Button className="gap-2">
                <Plus className="h-4 w-4" /> New contact
              </Button>
            </Link>
          </div>
        }
      />

      <SearchBar placeholder="Search contacts…" defaultValue={query} />

      {contacts.length === 0 ? (
        <Card className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <Users className="h-10 w-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No contacts yet.</p>
          <Link href="/app/contacts/new">
            <Button className="gap-2">
              <Plus className="h-4 w-4" /> Add your first contact
            </Button>
          </Link>
        </Card>
      ) : (
        <BulkTable
          noun="contact"
          columns={["Name", "Email", "Phone", "Company"]}
          deleteAction={bulkDeleteContacts}
          rows={contacts.map((c) => ({
            id: c.id,
            cells: [
              <div key="n">
                <Link href={`/app/contacts/${c.id}`} className="font-medium hover:underline">
                  {[c.firstName, c.lastName].filter(Boolean).join(" ") || "Unnamed contact"}
                </Link>
                {c.jobTitle && <div className="text-xs text-muted-foreground">{c.jobTitle}</div>}
              </div>,
              <span key="e" className="text-muted-foreground">{c.email ?? "—"}</span>,
              <span key="p" className="text-muted-foreground">{formatPhone(c.phone)}</span>,
              <span key="c" className="text-muted-foreground">{c.company?.name ?? "—"}</span>,
            ],
          }))}
        />
      )}
    </div>
  );
}
