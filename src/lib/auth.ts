import "server-only";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { WorkspaceRole } from "@prisma/client";
import { prisma } from "./prisma";
import { SESSION_COOKIE, signSession, verifySession, type SessionPayload } from "./jwt";

const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function createSession(payload: SessionPayload): Promise<void> {
  const token = await signSession(payload, SESSION_MAX_AGE);
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

export async function clearSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}

export async function getSession(): Promise<SessionPayload | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySession(token);
}

export interface AuthContext {
  userId: string;
  workspaceId: string;
  role: WorkspaceRole;
  user: { id: string; email: string; fullName: string };
  workspace: { id: string; name: string; slug: string };
}

/** Loads the full auth context (session + verified active membership). */
export async function getAuthContext(): Promise<AuthContext | null> {
  const session = await getSession();
  if (!session) return null;

  const membership = await prisma.workspaceMember.findUnique({
    where: {
      workspaceId_userId: {
        workspaceId: session.workspaceId,
        userId: session.userId,
      },
    },
    include: { user: true, workspace: true },
  });
  if (!membership) return null;

  return {
    userId: session.userId,
    workspaceId: session.workspaceId,
    role: membership.role,
    user: {
      id: membership.user.id,
      email: membership.user.email,
      fullName: membership.user.fullName,
    },
    workspace: {
      id: membership.workspace.id,
      name: membership.workspace.name,
      slug: membership.workspace.slug,
    },
  };
}

/** For server components / actions: returns context or redirects to /login. */
export async function requireAuth(): Promise<AuthContext> {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  return ctx;
}

export function canManageWorkspace(role: WorkspaceRole): boolean {
  return role === "OWNER" || role === "ADMIN";
}
