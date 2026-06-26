import "server-only";
import { createHash, randomBytes } from "crypto";
import { prisma } from "./prisma";

export function hashKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function generateApiKey(): { raw: string; hash: string; prefix: string } {
  const raw = "clv_" + randomBytes(24).toString("hex");
  return { raw, hash: hashKey(raw), prefix: raw.slice(0, 12) };
}

/** Resolves the workspace for a request authenticated with a Bearer API key, or null. */
export async function authenticateApiKey(req: Request): Promise<{ workspaceId: string } | null> {
  const auth = req.headers.get("authorization") || "";
  const m = auth.match(/^Bearer\s+(clv_[a-f0-9]{8,})$/i);
  if (!m) return null;
  const key = await prisma.apiKey.findUnique({ where: { keyHash: hashKey(m[1]) } });
  if (!key || key.revokedAt) return null;
  prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
  return { workspaceId: key.workspaceId };
}

export function apiError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}
