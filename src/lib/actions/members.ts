"use server";

import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAuth, createSession, canManageWorkspace } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hashInviteToken } from "@/lib/invite-token";

export interface InviteState {
  error?: string;
  link?: string;
}

const hashToken = hashInviteToken;

function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

const inviteSchema = z.object({
  email: z.string().email("Enter a valid email"),
  role: z.enum(["ADMIN", "MEMBER"]),
});

export async function createInvite(_prev: InviteState, formData: FormData): Promise<InviteState> {
  const ctx = await requireAuth();
  if (!canManageWorkspace(ctx.role)) {
    return { error: "Only owners and admins can invite members." };
  }
  const parsed = inviteSchema.safeParse({
    email: formData.get("email"),
    role: formData.get("role"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const token = randomBytes(24).toString("hex");
  try {
    await prisma.invitation.create({
      data: {
        workspaceId: ctx.workspaceId,
        email: parsed.data.email.toLowerCase(),
        role: parsed.data.role,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
  } catch (e) {
    console.error("createInvite failed", e);
    return { error: "Could not create the invitation." };
  }

  revalidatePath("/app/settings");
  return { link: `${appUrl()}/accept-invite/${token}` };
}

export async function acceptInvite(token: string): Promise<void> {
  const ctx = await requireAuth();
  const invitation = await prisma.invitation.findUnique({ where: { tokenHash: hashToken(token) } });

  if (!invitation || invitation.acceptedAt || invitation.expiresAt < new Date()) {
    redirect("/app?invite=invalid");
  }

  await prisma.$transaction(async (tx) => {
    await tx.workspaceMember.upsert({
      where: {
        workspaceId_userId: { workspaceId: invitation.workspaceId, userId: ctx.userId },
      },
      update: {},
      create: { workspaceId: invitation.workspaceId, userId: ctx.userId, role: invitation.role },
    });
    await tx.invitation.update({
      where: { id: invitation.id },
      data: { acceptedAt: new Date() },
    });
  });

  // Switch the active session to the workspace just joined.
  await createSession({ userId: ctx.userId, workspaceId: invitation.workspaceId });
  redirect("/app");
}

export async function switchWorkspace(workspaceId: string): Promise<void> {
  const ctx = await requireAuth();
  const membership = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: ctx.userId } },
  });
  if (!membership) redirect("/app");
  await createSession({ userId: ctx.userId, workspaceId });
  redirect("/app");
}
