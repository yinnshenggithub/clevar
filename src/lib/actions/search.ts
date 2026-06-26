"use server";

import { requireAuth } from "@/lib/auth";
import { withTenant } from "@/lib/tenant";
import { recordTitle, type FieldDefLite } from "@/lib/custom-objects";

export interface SearchHit {
  label: string;
  sub?: string;
  href: string;
}
export interface SearchGroup {
  group: string;
  hits: SearchHit[];
}

const contactName = (c: { firstName: string | null; lastName: string | null; email: string | null }) =>
  [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || "Unnamed contact";

/** Cross-object search across the workspace, grouped for the command palette. */
export async function globalSearch(q: string): Promise<SearchGroup[]> {
  const query = q.trim();
  if (query.length < 1) return [];
  const ctx = await requireAuth();
  const like = { contains: query, mode: "insensitive" as const };

  return withTenant(ctx.workspaceId, async (tx) => {
    const [contacts, companies, deals, convos, objects] = await Promise.all([
      tx.contact.findMany({
        where: { deletedAt: null, OR: [{ firstName: like }, { lastName: like }, { email: like }, { phone: like }] },
        take: 6,
        orderBy: { updatedAt: "desc" },
      }),
      tx.company.findMany({
        where: { deletedAt: null, OR: [{ name: like }, { domain: like }] },
        take: 6,
        orderBy: { updatedAt: "desc" },
      }),
      tx.deal.findMany({ where: { deletedAt: null, title: like }, take: 6, orderBy: { updatedAt: "desc" } }),
      tx.conversation.findMany({
        where: { OR: [{ customerName: like }, { customerPhone: like }] },
        take: 6,
        orderBy: { lastMessageAt: "desc" },
      }),
      tx.objectDefinition.findMany({ include: { fields: { orderBy: { position: "asc" } } } }),
    ]);

    const groups: SearchGroup[] = [];
    if (contacts.length)
      groups.push({
        group: "Contacts",
        hits: contacts.map((c) => ({ label: contactName(c), sub: c.email ?? c.phone ?? undefined, href: `/app/contacts/${c.id}` })),
      });
    if (companies.length)
      groups.push({
        group: "Companies",
        hits: companies.map((c) => ({ label: c.name, sub: c.domain ?? undefined, href: `/app/companies/${c.id}` })),
      });
    if (deals.length)
      groups.push({ group: "Deals", hits: deals.map((d) => ({ label: d.title, href: `/app/deals/${d.id}` })) });
    if (convos.length)
      groups.push({
        group: "Conversations",
        hits: convos.map((c) => ({ label: c.customerName || c.customerPhone, sub: c.customerPhone, href: `/app/inbox?c=${c.id}` })),
      });

    // Custom records: search the JSON values of each object's records (small scan, capped).
    for (const def of objects) {
      const records = await tx.customRecord.findMany({
        where: { objectDefinitionId: def.id, deletedAt: null },
        take: 50,
        orderBy: { updatedAt: "desc" },
      });
      const ql = query.toLowerCase();
      const hits = records
        .filter((r) =>
          Object.values(r.values as Record<string, unknown>).some((v) => String(v ?? "").toLowerCase().includes(ql)),
        )
        .slice(0, 5)
        .map((r) => ({
          label: recordTitle(def.fields as FieldDefLite[], r.values as Record<string, unknown>),
          href: `/app/o/${def.slug}/${r.id}`,
        }));
      if (hits.length) groups.push({ group: def.namePlural, hits });
    }

    return groups;
  });
}
