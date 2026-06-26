import { SignJWT, jwtVerify } from "jose";

// Edge-safe (jose only) so middleware can verify sessions without bundling
// Node-only crypto. Keep this file free of bcrypt/Prisma imports.

export const SESSION_COOKIE = "clevar_session";

export interface SessionPayload {
  userId: string;
  workspaceId: string;
}

function secret(): Uint8Array {
  const value = process.env.AUTH_SECRET;
  if (!value || value.length < 32) {
    throw new Error("AUTH_SECRET missing or too short (min 32 chars)");
  }
  return new TextEncoder().encode(value);
}

export async function signSession(
  payload: SessionPayload,
  maxAgeSeconds: number,
): Promise<string> {
  return new SignJWT({ ws: payload.workspaceId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.userId)
    .setIssuedAt()
    .setExpirationTime(`${maxAgeSeconds}s`)
    .sign(secret());
}

export async function verifySession(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    if (typeof payload.sub === "string" && typeof payload.ws === "string") {
      return { userId: payload.sub, workspaceId: payload.ws };
    }
    return null;
  } catch {
    return null;
  }
}
