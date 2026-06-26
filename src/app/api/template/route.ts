import { getAuthContext } from "@/lib/auth";
import { isCsvObject, templateCsv } from "@/lib/csv";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const ctx = await getAuthContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });

  const object = new URL(req.url).searchParams.get("object");
  if (!isCsvObject(object)) return new Response("Unknown object", { status: 400 });

  return new Response(templateCsv(object), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="clevar-${object}-template.csv"`,
    },
  });
}
