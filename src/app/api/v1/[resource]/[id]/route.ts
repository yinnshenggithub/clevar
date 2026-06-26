import { authenticateApiKey, apiError } from "@/lib/api-auth";
import { withTenant } from "@/lib/tenant";
import { isApiResource, getResource } from "@/lib/api-resources";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ resource: string; id: string }> }) {
  const { resource, id } = await params;
  if (!isApiResource(resource)) return apiError("Unknown resource", 404);
  const auth = await authenticateApiKey(req);
  if (!auth) return apiError("Invalid or missing API key", 401);

  const data = await withTenant(auth.workspaceId, (tx) => getResource(tx, resource, id));
  if (!data) return apiError("Not found", 404);
  return Response.json({ data });
}
