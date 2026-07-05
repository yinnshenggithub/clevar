"use server";

import { revalidatePath } from "next/cache";
import type { ConversationStatus, ConversationPriority } from "@prisma/client";
import { requireAuth } from "@/lib/auth";
import { withTenant } from "@/lib/tenant";
import { resolveConversationTransport, sendWaText } from "@/lib/wa-send";

export interface MacroState {
  error?: string;
  ok?: boolean;
}

export type MacroActionType =
  | "send_reply"
  | "add_note"
  | "add_label"
  | "set_status"
  | "set_priority"
  | "assign_user";

export interface MacroAction {
  type: MacroActionType;
  value: string;
}

const ACTION_TYPES: MacroActionType[] = ["send_reply", "add_note", "add_label", "set_status", "set_priority", "assign_user"];

function parseActions(raw: FormDataEntryValue | null): MacroAction[] {
  try {
    const arr = JSON.parse(String(raw ?? "[]"));
    if (!Array.isArray(arr)) return [];
    return arr
      .map((a) => ({ type: String(a?.type ?? ""), value: String(a?.value ?? "") }))
      .filter((a) => ACTION_TYPES.includes(a.type as MacroActionType) && a.value) as MacroAction[];
  } catch {
    return [];
  }
}

export async function createMacro(_prev: MacroState, formData: FormData): Promise<MacroState> {
  const ctx = await requireAuth();
  const name = String(formData.get("name") ?? "").trim().slice(0, 80);
  const actions = parseActions(formData.get("actions"));
  if (!name) return { error: "Name is required." };
  if (actions.length === 0) return { error: "Add at least one action." };
  try {
    await withTenant(ctx.workspaceId, (tx) =>
      tx.macro.create({ data: { workspaceId: ctx.workspaceId, name, actions: actions as object[] } }),
    );
  } catch (e) {
    console.error("createMacro failed", e);
    return { error: "Could not save the macro." };
  }
  revalidatePath("/app/inbox/macros");
  return { ok: true };
}

export async function deleteMacro(id: string): Promise<void> {
  const ctx = await requireAuth();
  await withTenant(ctx.workspaceId, (tx) => tx.macro.deleteMany({ where: { id } }));
  revalidatePath("/app/inbox/macros");
}

/** Runs every action in a macro against one conversation, in order. */
export async function runMacro(macroId: string, conversationId: string): Promise<MacroState> {
  const ctx = await requireAuth();
  const [macro, convo] = await withTenant(ctx.workspaceId, async (tx) => [
    await tx.macro.findFirst({ where: { id: macroId } }),
    await tx.conversation.findFirst({ where: { id: conversationId } }),
  ]);
  if (!macro || !convo) return { error: "Macro or conversation not found." };
  const actions = (Array.isArray(macro.actions) ? macro.actions : []) as unknown as MacroAction[];

  for (const a of actions) {
    try {
      if (a.type === "send_reply" && a.value) {
        // Route the reply through the conversation's own channel; other
        // channel types (webchat, messenger, …) don't support macro sends yet.
        if (convo.channelType === "whatsapp" || convo.channelType === "whatsapp_web") {
          const transport = await resolveConversationTransport(ctx.workspaceId, convo);
          if (transport) {
            const waId = await sendWaText(transport, convo.customerPhone, a.value);
            await withTenant(ctx.workspaceId, async (tx) => {
              await tx.message.create({
                data: { workspaceId: ctx.workspaceId, conversationId, direction: "OUTBOUND", authorUserId: ctx.userId, body: a.value, type: "text", waMessageId: waId },
              });
              await tx.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: new Date(), waitingSince: null } });
            });
          }
        }
      } else if (a.type === "add_note" && a.value) {
        await withTenant(ctx.workspaceId, (tx) =>
          tx.message.create({
            data: { workspaceId: ctx.workspaceId, conversationId, direction: "OUTBOUND", private: true, authorUserId: ctx.userId, body: a.value, type: "text" },
          }),
        );
      } else if (a.type === "add_label" && a.value) {
        await withTenant(ctx.workspaceId, async (tx) => {
          const exists = await tx.conversationLabel.findFirst({ where: { conversationId, labelId: a.value } });
          if (!exists) await tx.conversationLabel.create({ data: { workspaceId: ctx.workspaceId, conversationId, labelId: a.value } });
        });
      } else if (a.type === "set_status" && a.value) {
        await withTenant(ctx.workspaceId, (tx) =>
          tx.conversation.update({ where: { id: conversationId }, data: { status: a.value as ConversationStatus } }),
        );
      } else if (a.type === "set_priority" && a.value) {
        await withTenant(ctx.workspaceId, (tx) =>
          tx.conversation.update({ where: { id: conversationId }, data: { priority: a.value as ConversationPriority } }),
        );
      } else if (a.type === "assign_user" && a.value) {
        await withTenant(ctx.workspaceId, (tx) =>
          tx.conversation.update({ where: { id: conversationId }, data: { assignedUserId: a.value } }),
        );
      }
    } catch (e) {
      console.error("macro action failed", a.type, e);
    }
  }
  revalidatePath("/app/inbox");
  return { ok: true };
}
