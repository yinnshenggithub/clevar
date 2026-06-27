import "server-only";

export interface TriggerDef {
  token: string;
  label: string;
  group: string;
  /** fired by the cron scheduler rather than an inline event */
  scheduled?: boolean;
  /** short hint shown in the builder */
  hint?: string;
  /** dotted scope fields this trigger makes available, for the condition picker */
  fields?: string[];
}

/**
 * The catalog of triggers the engine can fire. Grouping mirrors the product
 * spec's picker. Event triggers are emitted from server actions / webhooks via
 * runWorkflows(); `scheduled` triggers are fired by /api/cron.
 */
export const TRIGGER_DEFS: TriggerDef[] = [
  // Contact
  { token: "contact_created", label: "Contact created", group: "Contact", fields: ["contact.email", "contact.phone", "trigger.recordName"] },
  { token: "contact_updated", label: "Contact changed", group: "Contact", hint: "Any contact field changes", fields: ["trigger.changedFields", "contact.email"] },
  { token: "contact_deleted", label: "Contact deleted", group: "Contact" },
  { token: "contact_tag_added", label: "Contact tag added", group: "Contact", fields: ["trigger.tag"] },
  { token: "contact_tag_removed", label: "Contact tag removed", group: "Contact", fields: ["trigger.tag"] },
  { token: "contact_dnd_changed", label: "Contact DND changed", group: "Contact", fields: ["contact.dnd"] },

  // Company
  { token: "company_created", label: "Company created", group: "Company" },
  { token: "company_updated", label: "Company changed", group: "Company" },

  // Opportunities (deals)
  { token: "deal_created", label: "Opportunity created", group: "Opportunities", fields: ["trigger.recordName", "deal.amount"] },
  { token: "deal_updated", label: "Opportunity changed", group: "Opportunities", fields: ["trigger.changedFields"] },
  { token: "deal_stage_changed", label: "Pipeline stage changed", group: "Opportunities", fields: ["trigger.stageName"] },
  { token: "deal_status_changed", label: "Opportunity status changed", group: "Opportunities", fields: ["trigger.toStatus", "trigger.fromStatus"] },
  { token: "deal_deleted", label: "Opportunity deleted", group: "Opportunities" },
  { token: "deal_stale", label: "Stale opportunities", group: "Opportunities", scheduled: true, hint: "No stage movement in N days" },

  // Tasks & Notes
  { token: "task_created", label: "Task added", group: "Tasks & Notes" },
  { token: "task_completed", label: "Task completed", group: "Tasks & Notes" },
  { token: "task_reminder", label: "Task reminder", group: "Tasks & Notes", scheduled: true, hint: "Before a task's due date" },
  { token: "note_created", label: "Note added", group: "Tasks & Notes" },

  // Messaging
  { token: "message_received", label: "Message received", group: "Messaging", fields: ["trigger.messageText", "trigger.customerPhone"] },

  // Events / scheduler
  { token: "scheduled", label: "Scheduler", group: "Events", scheduled: true, hint: "On a recurring schedule" },
  { token: "date_reminder", label: "Date reminder", group: "Events", scheduled: true, hint: "Birthday / custom date field" },
];

const BY_TOKEN = new Map(TRIGGER_DEFS.map((t) => [t.token, t]));

export function isTrigger(token: string): boolean {
  return BY_TOKEN.has(token);
}
export function getTrigger(token: string): TriggerDef | undefined {
  return BY_TOKEN.get(token);
}
export function triggerGroups(): { group: string; triggers: TriggerDef[] }[] {
  const order: string[] = [];
  const map = new Map<string, TriggerDef[]>();
  for (const t of TRIGGER_DEFS) {
    if (!map.has(t.group)) {
      map.set(t.group, []);
      order.push(t.group);
    }
    map.get(t.group)!.push(t);
  }
  return order.map((group) => ({ group, triggers: map.get(group)! }));
}
