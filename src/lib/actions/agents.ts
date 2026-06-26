"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { withTenant } from "@/lib/tenant";
import { DEFAULT_MODEL } from "@/lib/ai-models";

export interface FormState {
  error?: string;
}

const agentSchema = z.object({
  name: z.string().min(1, "Agent name is required").max(120),
  instructions: z.string().max(8000).optional(),
  model: z.string().min(1).max(80).optional(),
});

function readAgent(formData: FormData) {
  return agentSchema.safeParse({
    name: formData.get("name"),
    instructions: formData.get("instructions") || undefined,
    model: formData.get("model") || undefined,
  });
}

export async function createAgent(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireAuth();
  const parsed = readAgent(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const v = parsed.data;
  try {
    await withTenant(ctx.workspaceId, async (tx) => {
      await tx.aiAgent.create({
        data: {
          workspaceId: ctx.workspaceId,
          name: v.name,
          instructions: v.instructions || "",
          model: v.model || DEFAULT_MODEL,
        },
      });
    });
  } catch (e) {
    console.error("createAgent failed", e);
    return { error: "Could not create the agent." };
  }
  revalidatePath("/app/agents");
  redirect("/app/agents");
}

export async function updateAgent(
  id: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const ctx = await requireAuth();
  const parsed = readAgent(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const v = parsed.data;
  try {
    await withTenant(ctx.workspaceId, async (tx) => {
      await tx.aiAgent.update({
        where: { id },
        data: { name: v.name, instructions: v.instructions || "", model: v.model || DEFAULT_MODEL },
      });
    });
  } catch (e) {
    console.error("updateAgent failed", e);
    return { error: "Could not update the agent." };
  }
  revalidatePath("/app/agents");
  revalidatePath(`/app/agents/${id}`);
  redirect(`/app/agents/${id}`);
}

export async function deleteAgent(id: string): Promise<void> {
  const ctx = await requireAuth();
  await withTenant(ctx.workspaceId, async (tx) => {
    await tx.aiAgent.update({ where: { id }, data: { deletedAt: new Date() } });
  });
  revalidatePath("/app/agents");
  redirect("/app/agents");
}

/** Creates a fresh conversation for an agent and opens it. */
export async function newConversation(agentId: string): Promise<void> {
  const ctx = await requireAuth();
  let conversationId = "";
  await withTenant(ctx.workspaceId, async (tx) => {
    const agent = await tx.aiAgent.findFirst({ where: { id: agentId, deletedAt: null } });
    if (!agent) throw new Error("AGENT_NOT_FOUND");
    const convo = await tx.aiConversation.create({
      data: { workspaceId: ctx.workspaceId, agentId },
    });
    conversationId = convo.id;
  });
  redirect(`/app/agents/${agentId}/chat?c=${conversationId}`);
}
