import "server-only";
import { Prisma, type ObjectType, type ConversationStatus, type ConversationPriority, type DealStatus, type StageType } from "@prisma/client";
import { withTenant } from "../tenant";
import { logEventTx } from "../activity";
import { sendWhatsAppText } from "../whatsapp";
import type { ActionContext, ActionHandler, ActionResult } from "./types";
import { toNumber } from "./template";

export interface ActionDef {
  token: string;
  label: string;
  group: string;
  /** built but inert until external creds are configured (shown but flagged) */
  gated?: boolean;
  /** control-flow nodes are interpreted by the engine, not run as handlers */
  controlFlow?: boolean;
  run?: ActionHandler;
}

const statusForStage: Record<StageType, DealStatus> = { OPEN: "OPEN", WON: "WON", LOST: "LOST" };

/** Pick the ObjectType + id of the record the trigger is about, for notes/tasks/events. */
function parentOf(ac: ActionContext): { type: ObjectType; id: string } | null {
  if (ac.ctx.contactId) return { type: "CONTACT", id: ac.ctx.contactId };
  if (ac.ctx.dealId) return { type: "DEAL", id: ac.ctx.dealId };
  if (ac.ctx.companyId) return { type: "COMPANY", id: ac.ctx.companyId };
  return null;
}

const str = (v: unknown) => (v == null ? "" : String(v));

// ─────────────────────────────── handlers ────────────────────────────────────

const addTag: ActionHandler = async (config, ac) => {
  if (!ac.ctx.contactId) return;
  const tag = ac.render(str(config.tag)).trim();
  if (!tag) return;
  await withTenant(ac.workspaceId, async (tx) => {
    const c = await tx.contact.findFirst({ where: { id: ac.ctx.contactId! }, select: { tags: true } });
    if (!c) return;
    if (c.tags.includes(tag)) return;
    await tx.contact.update({ where: { id: ac.ctx.contactId! }, data: { tags: { set: [...c.tags, tag] } } });
  });
};

const removeTag: ActionHandler = async (config, ac) => {
  if (!ac.ctx.contactId) return;
  const tag = ac.render(str(config.tag)).trim();
  if (!tag) return;
  await withTenant(ac.workspaceId, async (tx) => {
    const c = await tx.contact.findFirst({ where: { id: ac.ctx.contactId! }, select: { tags: true } });
    if (!c) return;
    await tx.contact.update({ where: { id: ac.ctx.contactId! }, data: { tags: { set: c.tags.filter((t) => t !== tag) } } });
  });
};

const assignUser: ActionHandler = async (config, ac) => {
  if (!ac.ctx.contactId) return;
  const ownerId = str(config.userId).trim() || null;
  await withTenant(ac.workspaceId, (tx) => tx.contact.updateMany({ where: { id: ac.ctx.contactId! }, data: { ownerId } }));
};

const unassignUser: ActionHandler = async (_config, ac) => {
  if (!ac.ctx.contactId) return;
  await withTenant(ac.workspaceId, (tx) => tx.contact.updateMany({ where: { id: ac.ctx.contactId! }, data: { ownerId: null } }));
};

const setDnd: ActionHandler = async (config, ac) => {
  if (!ac.ctx.contactId) return;
  const enabled = config.enabled === true || config.enabled === "true";
  await withTenant(ac.workspaceId, (tx) => tx.contact.updateMany({ where: { id: ac.ctx.contactId! }, data: { dnd: enabled } }));
};

const modifyEngagement: ActionHandler = async (config, ac) => {
  if (!ac.ctx.contactId) return;
  const amount = toNumber(config.amount) ?? 0;
  const mode = str(config.mode) || "increment";
  await withTenant(ac.workspaceId, async (tx) => {
    if (mode === "set") {
      await tx.contact.updateMany({ where: { id: ac.ctx.contactId! }, data: { engagementScore: Math.round(amount) } });
    } else {
      await tx.contact.update({ where: { id: ac.ctx.contactId! }, data: { engagementScore: { increment: Math.round(amount) } } });
    }
  });
};

const BUILTIN_CONTACT_FIELDS = new Set(["firstName", "lastName", "email", "phone", "jobTitle"]);

const updateContactField: ActionHandler = async (config, ac) => {
  if (!ac.ctx.contactId) return;
  const field = str(config.field).trim();
  const value = ac.render(str(config.value));
  if (!field) return;
  await withTenant(ac.workspaceId, async (tx) => {
    if (BUILTIN_CONTACT_FIELDS.has(field)) {
      await tx.contact.updateMany({ where: { id: ac.ctx.contactId! }, data: { [field]: value || null } });
    } else {
      const c = await tx.contact.findFirst({ where: { id: ac.ctx.contactId! }, select: { customFields: true } });
      if (!c) return;
      const merged = { ...((c.customFields as Record<string, unknown>) ?? {}), [field]: value };
      await tx.contact.update({ where: { id: ac.ctx.contactId! }, data: { customFields: merged as Prisma.InputJsonValue } });
    }
  });
};

const createContact: ActionHandler = async (config, ac): Promise<ActionResult> => {
  const data = {
    firstName: ac.render(str(config.firstName)) || null,
    lastName: ac.render(str(config.lastName)) || null,
    email: ac.render(str(config.email)) || null,
    phone: ac.render(str(config.phone)) || null,
    jobTitle: ac.render(str(config.jobTitle)) || null,
  };
  const created = await withTenant(ac.workspaceId, (tx) =>
    tx.contact.create({ data: { workspaceId: ac.workspaceId, ...data } }),
  );
  // subsequent steps act on the newly-created contact
  ac.ctx.contactId = created.id;
  return { vars: { createdContactId: created.id } };
};

const copyContact: ActionHandler = async (_config, ac): Promise<ActionResult> => {
  if (!ac.ctx.contactId) return {};
  const copy = await withTenant(ac.workspaceId, async (tx) => {
    const c = await tx.contact.findFirst({ where: { id: ac.ctx.contactId! } });
    if (!c) return null;
    return tx.contact.create({
      data: {
        workspaceId: ac.workspaceId,
        firstName: c.firstName,
        lastName: c.lastName,
        email: c.email,
        phone: c.phone,
        jobTitle: c.jobTitle,
        companyId: c.companyId,
        tags: { set: c.tags },
        customFields: c.customFields as Prisma.InputJsonValue,
      },
    });
  });
  return copy ? { vars: { copiedContactId: copy.id } } : {};
};

const deleteContact: ActionHandler = async (_config, ac) => {
  if (!ac.ctx.contactId) return;
  await withTenant(ac.workspaceId, (tx) => tx.contact.updateMany({ where: { id: ac.ctx.contactId! }, data: { deletedAt: new Date() } }));
};

const findContact: ActionHandler = async (config, ac): Promise<ActionResult> => {
  const by = str(config.by) || "email";
  const value = ac.render(str(config.value)).trim();
  if (!value) return {};
  const found = await withTenant(ac.workspaceId, (tx) =>
    tx.contact.findFirst({ where: { [by]: value, deletedAt: null }, select: { id: true } }),
  );
  if (found) {
    ac.ctx.contactId = found.id;
    return { vars: { foundContactId: found.id } };
  }
  return { vars: { foundContactId: null } };
};

const addTask: ActionHandler = async (config, ac) => {
  const title = ac.render(str(config.title)).trim() || "Follow up";
  const body = ac.render(str(config.body)) || null;
  const assigneeId = str(config.assigneeId).trim() || null;
  const dueInDays = toNumber(config.dueInDays);
  const dueAt = dueInDays != null ? new Date(Date.now() + dueInDays * 86_400_000) : null;
  const parent = parentOf(ac);
  await withTenant(ac.workspaceId, async (tx) => {
    await tx.task.create({
      data: {
        workspaceId: ac.workspaceId,
        title,
        body,
        assigneeId,
        dueAt,
        parentType: parent?.type ?? null,
        parentId: parent?.id ?? null,
      },
    });
    if (parent) await logEventTx(tx, ac.workspaceId, parent.type, parent.id, "task_created", `Task: ${title}`, ac.ctx.actorId ?? null);
  });
};

const addNote: ActionHandler = async (config, ac) => {
  const body = ac.render(str(config.text ?? config.body)).trim();
  const parent = parentOf(ac);
  if (!body || !parent) return;
  await withTenant(ac.workspaceId, async (tx) => {
    await tx.note.create({ data: { workspaceId: ac.workspaceId, parentType: parent.type, parentId: parent.id, body } });
    await logEventTx(tx, ac.workspaceId, parent.type, parent.id, "note", body.slice(0, 140), ac.ctx.actorId ?? null);
  });
};

const createDeal: ActionHandler = async (config, ac): Promise<ActionResult> => {
  const title = ac.render(str(config.title)).trim() || "New deal";
  const pipelineId = str(config.pipelineId).trim();
  const stageId = str(config.stageId).trim();
  const amount = toNumber(config.amount);
  if (!pipelineId || !stageId) return {};
  const created = await withTenant(ac.workspaceId, async (tx) => {
    const stage = await tx.stage.findFirst({ where: { id: stageId, pipelineId } });
    if (!stage) return null;
    return tx.deal.create({
      data: {
        workspaceId: ac.workspaceId,
        title,
        pipelineId,
        stageId,
        status: statusForStage[stage.stageType],
        amount: amount != null ? amount.toFixed(2) : null,
        companyId: ac.ctx.companyId ?? null,
      },
    });
  });
  if (created) {
    ac.ctx.dealId = created.id;
    return { vars: { createdDealId: created.id } };
  }
  return {};
};

const moveDeal: ActionHandler = async (config, ac) => {
  if (!ac.ctx.dealId) return;
  const stageId = str(config.stageId).trim();
  if (!stageId) return;
  await withTenant(ac.workspaceId, async (tx) => {
    const stage = await tx.stage.findFirst({ where: { id: stageId } });
    if (!stage) return;
    await tx.deal.update({
      where: { id: ac.ctx.dealId! },
      data: { stageId, pipelineId: stage.pipelineId, status: statusForStage[stage.stageType] },
    });
    await logEventTx(tx, ac.workspaceId, "DEAL", ac.ctx.dealId!, "stage_changed", `Moved to ${stage.name}`, ac.ctx.actorId ?? null);
  });
};

const assignAgent: ActionHandler = async (config, ac) => {
  const agentId = str(config.agentId).trim() || null;
  if (!ac.ctx.conversationId) return;
  await withTenant(ac.workspaceId, (tx) =>
    tx.conversation.updateMany({ where: { id: ac.ctx.conversationId! }, data: { assignedAgentId: agentId } }),
  );
};

const CONV_STATUS = new Set(["OPEN", "PENDING", "SNOOZED", "RESOLVED"]);
const CONV_PRIORITY = new Set(["NONE", "LOW", "MEDIUM", "HIGH", "URGENT"]);

const setConversationStatus: ActionHandler = async (config, ac) => {
  const status = str(config.status).toUpperCase();
  if (!ac.ctx.conversationId || !CONV_STATUS.has(status)) return;
  await withTenant(ac.workspaceId, (tx) =>
    tx.conversation.updateMany({ where: { id: ac.ctx.conversationId! }, data: { status: status as ConversationStatus } }),
  );
};

const setConversationPriority: ActionHandler = async (config, ac) => {
  const priority = str(config.priority).toUpperCase();
  if (!ac.ctx.conversationId || !CONV_PRIORITY.has(priority)) return;
  await withTenant(ac.workspaceId, (tx) =>
    tx.conversation.updateMany({ where: { id: ac.ctx.conversationId! }, data: { priority: priority as ConversationPriority } }),
  );
};

const assignConversationUser: ActionHandler = async (config, ac) => {
  const userId = str(config.userId).trim() || null;
  if (!ac.ctx.conversationId) return;
  await withTenant(ac.workspaceId, (tx) =>
    tx.conversation.updateMany({ where: { id: ac.ctx.conversationId! }, data: { assignedUserId: userId } }),
  );
};

const sendWhatsApp: ActionHandler = async (config, ac): Promise<ActionResult> => {
  const text = ac.render(str(config.text)).trim();
  if (!text || !ac.ctx.conversationId || !ac.ctx.channel || !ac.ctx.customerPhone) return {};
  const waId = await sendWhatsAppText(ac.ctx.channel.phoneNumberId, ac.ctx.channel.accessToken, ac.ctx.customerPhone, text);
  await withTenant(ac.workspaceId, async (tx) => {
    await tx.message.create({
      data: { workspaceId: ac.workspaceId, conversationId: ac.ctx.conversationId!, direction: "OUTBOUND", body: text, waMessageId: waId },
    });
    await tx.conversation.update({ where: { id: ac.ctx.conversationId! }, data: { lastMessageAt: new Date() } });
  });
  return { repliedExternally: true };
};

const setCustomValue: ActionHandler = async (config, ac) => {
  const key = str(config.key).trim();
  const value = ac.render(str(config.value));
  if (!key) return;
  await withTenant(ac.workspaceId, (tx) =>
    tx.workspaceCustomValue.upsert({
      where: { workspaceId_key: { workspaceId: ac.workspaceId, key } },
      update: { value },
      create: { workspaceId: ac.workspaceId, key, value },
    }),
  );
};

const callWebhook: ActionHandler = async (config, ac): Promise<ActionResult> => {
  const url = ac.render(str(config.url)).trim();
  if (!/^https?:\/\//i.test(url)) return {};
  const method = (str(config.method) || "POST").toUpperCase();
  const bodyTpl = config.body != null ? ac.render(str(config.body)) : JSON.stringify({ trigger: ac.ctx, vars: ac.scope.vars });
  let headers: Record<string, string> = { "content-type": "application/json" };
  if (config.headers && typeof config.headers === "object") {
    headers = { ...headers, ...(config.headers as Record<string, string>) };
  }
  try {
    const res = await fetch(url, {
      method,
      headers,
      body: method === "GET" || method === "HEAD" ? undefined : bodyTpl,
      signal: AbortSignal.timeout(8000),
    });
    return { vars: { webhookStatus: res.status } };
  } catch (e) {
    console.error("workflow webhook failed", url, e);
    return { vars: { webhookStatus: 0 } };
  }
};

// ── formatters / math (write to vars[output]) ────────────────────────────────

const formatText: ActionHandler = async (config, ac): Promise<ActionResult> => {
  const input = ac.render(str(config.input));
  const out = str(config.output) || "text";
  let r = input;
  switch (str(config.operation)) {
    case "uppercase": r = input.toUpperCase(); break;
    case "lowercase": r = input.toLowerCase(); break;
    case "trim": r = input.trim(); break;
    case "capitalize": r = input.charAt(0).toUpperCase() + input.slice(1); break;
    case "slug": r = input.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""); break;
    default: break;
  }
  return { vars: { [out]: r } };
};

const formatNumber: ActionHandler = async (config, ac): Promise<ActionResult> => {
  const n = toNumber(ac.render(str(config.input))) ?? 0;
  const out = str(config.output) || "number";
  const decimals = toNumber(config.decimals);
  let r: number | string = n;
  switch (str(config.operation)) {
    case "round": r = decimals != null ? Number(n.toFixed(decimals)) : Math.round(n); break;
    case "floor": r = Math.floor(n); break;
    case "ceil": r = Math.ceil(n); break;
    case "abs": r = Math.abs(n); break;
    case "fixed": r = n.toFixed(decimals ?? 2); break;
    default: break;
  }
  return { vars: { [out]: r } };
};

const mathOperation: ActionHandler = async (config, ac): Promise<ActionResult> => {
  const a = toNumber(ac.render(str(config.a))) ?? 0;
  const b = toNumber(ac.render(str(config.b))) ?? 0;
  const out = str(config.output) || "result";
  let r = 0;
  switch (str(config.op)) {
    case "+": r = a + b; break;
    case "-": r = a - b; break;
    case "*": r = a * b; break;
    case "/": r = b !== 0 ? a / b : 0; break;
    case "%": r = b !== 0 ? a % b : 0; break;
    default: break;
  }
  return { vars: { [out]: r } };
};

const formatDate: ActionHandler = async (config, ac): Promise<ActionResult> => {
  const raw = ac.render(str(config.input)).trim();
  const out = str(config.output) || "date";
  const base = raw ? new Date(raw) : new Date();
  if (Number.isNaN(base.getTime())) return { vars: { [out]: "" } };
  const addDays = toNumber(config.addDays);
  const d = addDays != null ? new Date(base.getTime() + addDays * 86_400_000) : base;
  let r: string;
  switch (str(config.format)) {
    case "date": r = d.toISOString().slice(0, 10); break;
    case "time": r = d.toISOString().slice(11, 16); break;
    case "iso": default: r = d.toISOString(); break;
  }
  return { vars: { [out]: r } };
};

const formatArray: ActionHandler = async (config, ac): Promise<ActionResult> => {
  const rawInput = config.input;
  const sep = str(config.separator) || ",";
  const arr: string[] = Array.isArray(rawInput)
    ? rawInput.map(str)
    : ac.render(str(rawInput)).split(sep).map((s) => s.trim()).filter(Boolean);
  const out = str(config.output) || "array";
  let r: unknown = arr;
  switch (str(config.operation)) {
    case "count": r = arr.length; break;
    case "first": r = arr[0] ?? ""; break;
    case "last": r = arr[arr.length - 1] ?? ""; break;
    case "unique": r = Array.from(new Set(arr)).join(sep); break;
    case "join": r = arr.join(str(config.joinWith) || ", "); break;
    default: r = arr.join(sep); break;
  }
  return { vars: { [out]: r } };
};

const removeFromWorkflow: ActionHandler = async (): Promise<ActionResult> => ({ stop: true });

// ─────────────────────────────── registry ────────────────────────────────────

export const ACTION_DEFS: ActionDef[] = [
  // Contact
  { token: "create_contact", label: "Create contact", group: "Contact", run: createContact },
  { token: "find_contact", label: "Find contact", group: "Contact", run: findContact },
  { token: "update_contact_field", label: "Update contact field", group: "Contact", run: updateContactField },
  { token: "add_tag", label: "Add contact tag", group: "Contact", run: addTag },
  { token: "remove_tag", label: "Remove contact tag", group: "Contact", run: removeTag },
  { token: "assign_user", label: "Assign to user", group: "Contact", run: assignUser },
  { token: "unassign_user", label: "Remove assigned user", group: "Contact", run: unassignUser },
  { token: "set_dnd", label: "Enable/disable DND", group: "Contact", run: setDnd },
  { token: "modify_engagement", label: "Modify engagement score", group: "Contact", run: modifyEngagement },
  { token: "copy_contact", label: "Copy contact", group: "Contact", run: copyContact },
  { token: "delete_contact", label: "Delete contact", group: "Contact", run: deleteContact },

  // Tasks & notes
  { token: "add_task", label: "Add task", group: "Tasks & Notes", run: addTask },
  { token: "add_note", label: "Add to notes", group: "Tasks & Notes", run: addNote },

  // Opportunities
  { token: "create_deal", label: "Create opportunity", group: "Opportunities", run: createDeal },
  { token: "move_deal", label: "Move opportunity stage", group: "Opportunities", run: moveDeal },

  // Communication
  { token: "assign_agent", label: "Assign AI agent (auto-reply)", group: "Communication", run: assignAgent },
  { token: "send_reply", label: "Send WhatsApp reply", group: "Communication", run: sendWhatsApp },
  { token: "send_whatsapp", label: "WhatsApp message", group: "Communication", run: sendWhatsApp },
  { token: "set_conversation_status", label: "Update conversation status", group: "Communication", run: setConversationStatus },
  { token: "set_conversation_priority", label: "Set conversation priority", group: "Communication", run: setConversationPriority },
  { token: "assign_conversation_user", label: "Assign conversation to user", group: "Communication", run: assignConversationUser },

  // Send data
  { token: "webhook", label: "Custom webhook", group: "Send data", run: callWebhook },

  // Internal / control flow + utilities
  { token: "if_else", label: "If / else", group: "Internal", controlFlow: true },
  { token: "split", label: "Split (A/B)", group: "Internal", controlFlow: true },
  { token: "wait", label: "Wait", group: "Internal", controlFlow: true },
  { token: "goto", label: "Go to", group: "Internal", controlFlow: true },
  { token: "set_custom_value", label: "Update custom value", group: "Internal", run: setCustomValue },
  { token: "formatter_text", label: "Text formatter", group: "Internal", run: formatText },
  { token: "formatter_number", label: "Number formatter", group: "Internal", run: formatNumber },
  { token: "formatter_date", label: "Date/time formatter", group: "Internal", run: formatDate },
  { token: "formatter_array", label: "Array formatter", group: "Internal", run: formatArray },
  { token: "math_operation", label: "Math operation", group: "Internal", run: mathOperation },
  { token: "remove_from_workflow", label: "Remove from workflow", group: "Internal", run: removeFromWorkflow },
];

const BY_TOKEN = new Map(ACTION_DEFS.map((a) => [a.token, a]));

export function getAction(token: string): ActionDef | undefined {
  return BY_TOKEN.get(token);
}
export function isAction(token: string): boolean {
  return BY_TOKEN.has(token);
}
export function actionGroups(): { group: string; actions: ActionDef[] }[] {
  const order: string[] = [];
  const map = new Map<string, ActionDef[]>();
  for (const a of ACTION_DEFS) {
    if (!map.has(a.group)) {
      map.set(a.group, []);
      order.push(a.group);
    }
    map.get(a.group)!.push(a);
  }
  return order.map((group) => ({ group, actions: map.get(group)! }));
}
