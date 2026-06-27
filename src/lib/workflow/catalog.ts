// Client-safe metadata for the workflow builder + server-side validation.
// Single source of truth for trigger/action tokens, labels, grouping, and the
// per-action config-field specs. NO "server-only" — imported by both the React
// builder and the server engine. Runtime handlers live in actions.ts.

export interface TriggerDef {
  token: string;
  label: string;
  group: string;
  scheduled?: boolean;
  hint?: string;
  /** dotted scope fields available to conditions for this trigger */
  fields?: string[];
}

export type FieldType =
  | "text"
  | "textarea"
  | "number"
  | "select"
  | "boolean"
  | "agent"
  | "user"
  | "pipeline"
  | "stage"
  | "status"
  | "priority";

export interface ActionField {
  name: string;
  label: string;
  type: FieldType;
  options?: { value: string; label: string }[];
  placeholder?: string;
}

export interface ActionMeta {
  token: string;
  label: string;
  group: string;
  gated?: boolean;
  controlFlow?: boolean;
  /** hidden from the builder's action picker (engine-only for now) */
  hidden?: boolean;
  fields?: ActionField[];
}

// ─────────────────────────────── triggers ────────────────────────────────────

export const TRIGGER_DEFS: TriggerDef[] = [
  { token: "contact_created", label: "Contact created", group: "Contact", fields: ["contact.email", "contact.phone", "trigger.recordName"] },
  { token: "contact_updated", label: "Contact changed", group: "Contact", hint: "Any contact field changes", fields: ["trigger.changedFields", "contact.email", "contact.tags"] },
  { token: "contact_deleted", label: "Contact deleted", group: "Contact" },
  { token: "contact_tag_added", label: "Contact tag added", group: "Contact", fields: ["trigger.tag"] },
  { token: "contact_tag_removed", label: "Contact tag removed", group: "Contact", fields: ["trigger.tag"] },
  { token: "contact_dnd_changed", label: "Contact DND changed", group: "Contact", fields: ["contact.dnd"] },

  { token: "company_created", label: "Company created", group: "Company" },
  { token: "company_updated", label: "Company changed", group: "Company" },

  { token: "deal_created", label: "Opportunity created", group: "Opportunities", fields: ["trigger.recordName", "deal.amount"] },
  { token: "deal_updated", label: "Opportunity changed", group: "Opportunities", fields: ["trigger.changedFields"] },
  { token: "deal_stage_changed", label: "Pipeline stage changed", group: "Opportunities", fields: ["trigger.stageName"] },
  { token: "deal_status_changed", label: "Opportunity status changed", group: "Opportunities", fields: ["trigger.toStatus", "trigger.fromStatus"] },
  { token: "deal_deleted", label: "Opportunity deleted", group: "Opportunities" },
  { token: "deal_stale", label: "Stale opportunities", group: "Opportunities", scheduled: true, hint: "No activity in N days (set in condition)" },

  { token: "task_created", label: "Task added", group: "Tasks & Notes" },
  { token: "task_completed", label: "Task completed", group: "Tasks & Notes" },
  { token: "task_reminder", label: "Task reminder", group: "Tasks & Notes", scheduled: true, hint: "Due within N hours (set in condition)" },
  { token: "note_created", label: "Note added", group: "Tasks & Notes" },

  { token: "message_received", label: "Message received", group: "Messaging", fields: ["trigger.messageText", "trigger.customerPhone"] },

  { token: "scheduled", label: "Scheduler", group: "Events", scheduled: true, hint: "Runs on the cron cadence" },
];

// ─────────────────────────────── actions ─────────────────────────────────────

const STATUS_OPTS = ["OPEN", "PENDING", "SNOOZED", "RESOLVED"].map((v) => ({ value: v, label: v[0] + v.slice(1).toLowerCase() }));
const PRIORITY_OPTS = ["NONE", "LOW", "MEDIUM", "HIGH", "URGENT"].map((v) => ({ value: v, label: v[0] + v.slice(1).toLowerCase() }));
const opt = (...vs: string[]) => vs.map((v) => ({ value: v, label: v }));

export const ACTION_META: ActionMeta[] = [
  // Contact
  { token: "create_contact", label: "Create contact", group: "Contact", fields: [
    { name: "firstName", label: "First name", type: "text" },
    { name: "lastName", label: "Last name", type: "text" },
    { name: "email", label: "Email", type: "text" },
    { name: "phone", label: "Phone", type: "text" },
    { name: "jobTitle", label: "Job title", type: "text" },
  ] },
  { token: "find_contact", label: "Find contact", group: "Contact", fields: [
    { name: "by", label: "Match by", type: "select", options: opt("email", "phone") },
    { name: "value", label: "Value", type: "text", placeholder: "{{trigger.customerPhone}}" },
  ] },
  { token: "update_contact_field", label: "Update contact field", group: "Contact", fields: [
    { name: "field", label: "Field", type: "select", options: [...opt("firstName", "lastName", "email", "phone", "jobTitle")] },
    { name: "value", label: "Value", type: "text" },
  ] },
  { token: "add_tag", label: "Add contact tag", group: "Contact", fields: [{ name: "tag", label: "Tag", type: "text" }] },
  { token: "remove_tag", label: "Remove contact tag", group: "Contact", fields: [{ name: "tag", label: "Tag", type: "text" }] },
  { token: "assign_user", label: "Assign to user", group: "Contact", fields: [{ name: "userId", label: "User", type: "user" }] },
  { token: "unassign_user", label: "Remove assigned user", group: "Contact" },
  { token: "set_dnd", label: "Enable/disable DND", group: "Contact", fields: [{ name: "enabled", label: "Do not disturb", type: "boolean" }] },
  { token: "modify_engagement", label: "Modify engagement score", group: "Contact", fields: [
    { name: "mode", label: "Mode", type: "select", options: opt("increment", "set") },
    { name: "amount", label: "Amount", type: "number" },
  ] },
  { token: "copy_contact", label: "Copy contact", group: "Contact" },
  { token: "delete_contact", label: "Delete contact", group: "Contact" },

  // Tasks & notes
  { token: "add_task", label: "Add task", group: "Tasks & Notes", fields: [
    { name: "title", label: "Title", type: "text" },
    { name: "body", label: "Details", type: "textarea" },
    { name: "assigneeId", label: "Assign to", type: "user" },
    { name: "dueInDays", label: "Due in (days)", type: "number" },
  ] },
  { token: "add_note", label: "Add to notes", group: "Tasks & Notes", fields: [{ name: "text", label: "Note", type: "textarea" }] },

  // Opportunities
  { token: "create_deal", label: "Create opportunity", group: "Opportunities", fields: [
    { name: "title", label: "Title", type: "text" },
    { name: "pipelineId", label: "Pipeline", type: "pipeline" },
    { name: "stageId", label: "Stage", type: "stage" },
    { name: "amount", label: "Amount", type: "number" },
  ] },
  { token: "move_deal", label: "Move opportunity stage", group: "Opportunities", fields: [{ name: "stageId", label: "Stage", type: "stage" }] },

  // Communication
  { token: "assign_agent", label: "Assign AI agent (auto-reply)", group: "Communication", fields: [{ name: "agentId", label: "AI agent", type: "agent" }] },
  { token: "send_reply", label: "Send WhatsApp reply", group: "Communication", fields: [{ name: "text", label: "Message", type: "textarea" }] },
  { token: "send_whatsapp", label: "WhatsApp message", group: "Communication", fields: [{ name: "text", label: "Message", type: "textarea" }] },
  { token: "set_conversation_status", label: "Update conversation status", group: "Communication", fields: [{ name: "status", label: "Status", type: "status", options: STATUS_OPTS }] },
  { token: "set_conversation_priority", label: "Set conversation priority", group: "Communication", fields: [{ name: "priority", label: "Priority", type: "priority", options: PRIORITY_OPTS }] },
  { token: "assign_conversation_user", label: "Assign conversation to user", group: "Communication", fields: [{ name: "userId", label: "User", type: "user" }] },

  // Send data
  { token: "webhook", label: "Custom webhook", group: "Send data", fields: [
    { name: "url", label: "URL", type: "text", placeholder: "https://…" },
    { name: "method", label: "Method", type: "select", options: opt("POST", "GET", "PUT", "PATCH", "DELETE") },
    { name: "body", label: "Body (JSON, optional)", type: "textarea" },
  ] },

  // Internal / utilities
  { token: "wait", label: "Wait", group: "Internal", controlFlow: true, fields: [
    { name: "amount", label: "Amount", type: "number" },
    { name: "unit", label: "Unit", type: "select", options: opt("minutes", "hours", "days") },
  ] },
  { token: "if_else", label: "If / else (branch)", group: "Internal", controlFlow: true },
  { token: "split", label: "Split (A/B test)", group: "Internal", controlFlow: true },
  { token: "goto", label: "Go to", group: "Internal", controlFlow: true, hidden: true },
  { token: "set_custom_value", label: "Update custom value", group: "Internal", fields: [
    { name: "key", label: "Key", type: "text" },
    { name: "value", label: "Value", type: "text" },
  ] },
  { token: "formatter_text", label: "Text formatter", group: "Internal", fields: [
    { name: "input", label: "Input", type: "text" },
    { name: "operation", label: "Operation", type: "select", options: opt("uppercase", "lowercase", "trim", "capitalize", "slug") },
    { name: "output", label: "Save to variable", type: "text", placeholder: "text" },
  ] },
  { token: "formatter_number", label: "Number formatter", group: "Internal", fields: [
    { name: "input", label: "Input", type: "text" },
    { name: "operation", label: "Operation", type: "select", options: opt("round", "floor", "ceil", "abs", "fixed") },
    { name: "decimals", label: "Decimals", type: "number" },
    { name: "output", label: "Save to variable", type: "text", placeholder: "number" },
  ] },
  { token: "formatter_date", label: "Date/time formatter", group: "Internal", fields: [
    { name: "input", label: "Input (blank = now)", type: "text" },
    { name: "format", label: "Format", type: "select", options: opt("iso", "date", "time") },
    { name: "addDays", label: "Add days", type: "number" },
    { name: "output", label: "Save to variable", type: "text", placeholder: "date" },
  ] },
  { token: "formatter_array", label: "Array formatter", group: "Internal", fields: [
    { name: "input", label: "Input", type: "text" },
    { name: "operation", label: "Operation", type: "select", options: opt("join", "count", "first", "last", "unique") },
    { name: "separator", label: "Separator", type: "text", placeholder: "," },
    { name: "output", label: "Save to variable", type: "text", placeholder: "array" },
  ] },
  { token: "math_operation", label: "Math operation", group: "Internal", fields: [
    { name: "a", label: "A", type: "text" },
    { name: "op", label: "Operator", type: "select", options: opt("+", "-", "*", "/", "%") },
    { name: "b", label: "B", type: "text" },
    { name: "output", label: "Save to variable", type: "text", placeholder: "result" },
  ] },
  { token: "remove_from_workflow", label: "Remove from workflow", group: "Internal" },
];

// ─────────────────────────────── condition ops ───────────────────────────────

export const CONDITION_OPS = [
  { value: "contains", label: "contains" },
  { value: "equals", label: "equals" },
  { value: "not_equals", label: "does not equal" },
  { value: "not_contains", label: "does not contain" },
  { value: "starts_with", label: "starts with" },
  { value: "exists", label: "is set" },
  { value: "not_exists", label: "is empty" },
  { value: "gt", label: "greater than" },
  { value: "lt", label: "less than" },
  { value: "has_tag", label: "has tag" },
  { value: "is_true", label: "is true" },
  { value: "is_false", label: "is false" },
] as const;

/** Default condition fields offered in the builder (trigger fields + common record fields). */
export const COMMON_CONDITION_FIELDS = [
  "trigger.messageText",
  "trigger.recordName",
  "trigger.stageName",
  "trigger.tag",
  "trigger.toStatus",
  "contact.email",
  "contact.phone",
  "contact.tags",
  "contact.dnd",
  "contact.engagementScore",
  "deal.amount",
  "deal.status",
];

// ─────────────────────────────── helpers ─────────────────────────────────────

const TRIG = new Map(TRIGGER_DEFS.map((t) => [t.token, t]));
const ACT = new Map(ACTION_META.map((a) => [a.token, a]));

export const isTrigger = (t: string) => TRIG.has(t);
export const getTrigger = (t: string) => TRIG.get(t);
export const isAction = (t: string) => ACT.has(t);
export const getActionMeta = (t: string) => ACT.get(t);

function groupOf<T extends { group: string }>(items: T[]): { group: string; items: T[] }[] {
  const order: string[] = [];
  const map = new Map<string, T[]>();
  for (const it of items) {
    if (!map.has(it.group)) {
      map.set(it.group, []);
      order.push(it.group);
    }
    map.get(it.group)!.push(it);
  }
  return order.map((group) => ({ group, items: map.get(group)! }));
}

export const triggerGroups = () => groupOf(TRIGGER_DEFS).map(({ group, items }) => ({ group, triggers: items }));
export const actionGroups = () => groupOf(ACTION_META.filter((a) => !a.hidden)).map(({ group, items }) => ({ group, actions: items }));

export function conditionFieldsFor(triggerToken: string): string[] {
  const t = TRIG.get(triggerToken);
  const fields = new Set<string>([...(t?.fields ?? []), ...COMMON_CONDITION_FIELDS]);
  return Array.from(fields);
}
