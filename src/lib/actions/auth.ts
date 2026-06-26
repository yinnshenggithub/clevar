"use server";

import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withTenant } from "@/lib/tenant";
import { hashPassword, verifyPassword, createSession, clearSession } from "@/lib/auth";
import { slugify } from "@/lib/utils";

export interface ActionState {
  error?: string;
}

const signupSchema = z.object({
  fullName: z.string().min(1, "Your name is required").max(120),
  email: z.string().email("Enter a valid email"),
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
  workspaceName: z.string().min(1, "Workspace name is required").max(80),
});

async function uniqueSlug(base: string): Promise<string> {
  const root = slugify(base) || "workspace";
  for (let attempt = 0; attempt < 6; attempt++) {
    const candidate = attempt === 0 ? root : `${root}-${Math.random().toString(36).slice(2, 6)}`;
    const exists = await prisma.workspace.findUnique({ where: { slug: candidate } });
    if (!exists) return candidate;
  }
  return `${root}-${Date.now().toString(36)}`;
}

const DEFAULT_STAGES = [
  { name: "Lead", position: 0, stageType: "OPEN" as const },
  { name: "Qualified", position: 1, stageType: "OPEN" as const },
  { name: "Proposal", position: 2, stageType: "OPEN" as const },
  { name: "Won", position: 3, stageType: "WON" as const },
  { name: "Lost", position: 4, stageType: "LOST" as const },
];

export async function signupAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = signupSchema.safeParse({
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    password: formData.get("password"),
    workspaceName: formData.get("workspaceName"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { fullName, email, password, workspaceName } = parsed.data;

  try {
    const passwordHash = await hashPassword(password);
    const slug = await uniqueSlug(workspaceName);

    // Control-plane writes (no RLS): user, workspace, owner membership.
    const { user, workspace } = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { email: email.toLowerCase(), passwordHash, fullName },
      });
      const workspace = await tx.workspace.create({
        data: { name: workspaceName, slug },
      });
      await tx.workspaceMember.create({
        data: { workspaceId: workspace.id, userId: user.id, role: "OWNER" },
      });
      return { user, workspace };
    });

    // Tenant-plane seed (RLS): default pipeline + stages, scoped to the workspace.
    await withTenant(workspace.id, async (tx) => {
      const pipeline = await tx.pipeline.create({
        data: { workspaceId: workspace.id, name: "Sales", isDefault: true, position: 0 },
      });
      await tx.stage.createMany({
        data: DEFAULT_STAGES.map((s) => ({ ...s, workspaceId: workspace.id, pipelineId: pipeline.id })),
      });
    });

    await createSession({ userId: user.id, workspaceId: workspace.id });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { error: "An account with that email already exists." };
    }
    console.error("signup failed", e);
    return { error: "Something went wrong creating your account." };
  }

  redirect("/app");
}

const loginSchema = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
});

export async function loginAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { email, password } = parsed.data;

  try {
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    const ok = user ? await verifyPassword(password, user.passwordHash) : false;
    if (!user || !ok) {
      return { error: "Incorrect email or password." };
    }
    const membership = await prisma.workspaceMember.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
    });
    if (!membership) {
      return { error: "Your account has no workspace. Contact support." };
    }
    await createSession({ userId: user.id, workspaceId: membership.workspaceId });
  } catch (e) {
    console.error("login failed", e);
    return { error: "Something went wrong signing you in." };
  }

  redirect("/app");
}

export async function logoutAction(): Promise<void> {
  await clearSession();
  redirect("/login");
}
