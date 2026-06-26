import { authenticateApiKey, apiError } from "@/lib/api-auth";
import { withTenant } from "@/lib/tenant";
import { isApiResource, listResource, createResource, ApiValidationError } from "@/lib/api-resources";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ resource: string }> }) {
  const { resource } = await params;
  if (!isApiResource(resource)) return apiError("Unknown resource", 404);
  const auth = await authenticateApiKey(req);
  if (!auth) return apiError("Invalid or missing API key", 401);

  const url = new URL(req.url);
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 50));
  const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);

  const data = await withTenant(auth.workspaceId, (tx) => listResource(tx, resource, limit, offset));
  return Response.json({ data, limit, offset });
}

export async function POST(req: Request, { params }: { params: Promise<{ resource: string }> }) {
  const { resource } = await params;
  if (!isApiResource(resource)) return apiError("Unknown resource", 404);
  const auth = await authenticateApiKey(req);
  if (!auth) return apiError("Invalid or missing API key", 401);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return apiError("Invalid JSON body", 400);
  }

  try {
    const created = await withTenant(auth.workspaceId, (tx) => createResource(tx, auth.workspaceId, resource, body));
    return Response.json({ data: created }, { status: 201 });
  } catch (e) {
    if (e instanceof ApiValidationError) return apiError(e.message, 422);
    console.error("api create failed", e);
    return apiError("Could not create the record", 500);
  }
}
