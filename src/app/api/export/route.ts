import { getAuthContext } from "@/lib/auth";
import { withTenant } from "@/lib/tenant";
import { CSV_HEADERS, isCsvObject, toCsv } from "@/lib/csv";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const ctx = await getAuthContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });

  const object = new URL(req.url).searchParams.get("object");
  if (!isCsvObject(object)) return new Response("Unknown object", { status: 400 });

  const rows = await withTenant(ctx.workspaceId, async (tx) => {
    if (object === "contacts") {
      const cs = await tx.contact.findMany({
        where: { deletedAt: null },
        include: { company: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
      });
      return cs.map((c) => ({
        firstName: c.firstName ?? "",
        lastName: c.lastName ?? "",
        email: c.email ?? "",
        phone: c.phone ?? "",
        phoneRegion: "",
        jobTitle: c.jobTitle ?? "",
        companyName: c.company?.name ?? "",
      }));
    }
    if (object === "companies") {
      const cs = await tx.company.findMany({ where: { deletedAt: null }, orderBy: { createdAt: "desc" } });
      return cs.map((c) => ({ name: c.name, domain: c.domain ?? "", industry: c.industry ?? "" }));
    }
    const ds = await tx.deal.findMany({
      where: { deletedAt: null },
      include: { company: { select: { name: true } }, stage: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    });
    return ds.map((d) => ({
      title: d.title,
      amount: d.amount ? Number(d.amount).toString() : "",
      currency: d.currency,
      companyName: d.company?.name ?? "",
      stageName: d.stage?.name ?? "",
      expectedCloseAt: d.expectedCloseAt ? d.expectedCloseAt.toISOString().slice(0, 10) : "",
    }));
  });

  const csv = toCsv(CSV_HEADERS[object], rows);
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="clevar-${object}.csv"`,
    },
  });
}
