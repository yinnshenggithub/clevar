import "server-only";

/**
 * Runtime context threaded through a workflow run. Carries the identity of the
 * triggering record(s), the trigger payload, and the engine's working memory
 * (`vars`, populated by formatter / find steps). Persisted verbatim into
 * WorkflowRun.context when a run suspends on a Wait step, so every field must be
 * JSON-serializable — EXCEPT `channel`, which is re-resolved on resume.
 */
export interface WorkflowContext {
  // identity of the triggering record(s)
  contactId?: string;
  companyId?: string;
  dealId?: string;
  taskId?: string;
  noteId?: string;
  conversationId?: string;

  // trigger payload / metadata
  recordName?: string;
  stageName?: string;
  messageText?: string;
  customerPhone?: string;
  status?: string;
  fromStatus?: string;
  toStatus?: string;
  changedFields?: string[];
  tag?: string;
  actorId?: string;

  // messaging send context (not persisted across waits — re-resolved)
  channel?: { phoneNumberId: string; accessToken: string };

  // engine working memory: formatter outputs, find-step results, etc.
  vars?: Record<string, unknown>;
}

export interface StepCondition {
  field: string; // dotted path resolvable against the scope, e.g. "contact.email", "trigger.messageText"
  op: ConditionOp;
  value?: string;
}

export type ConditionOp =
  | "exists"
  | "not_exists"
  | "equals"
  | "not_equals"
  | "contains"
  | "not_contains"
  | "starts_with"
  | "gt"
  | "lt"
  | "has_tag"
  | "is_true"
  | "is_false";

/**
 * One node in a stored workflow. The canvas serializes an ordered `steps`
 * array. Control-flow nodes (if_else, split) carry nested `branches`; `wait`
 * and `goto` are handled by the interpreter. Legacy `agentId`/`text` fields are
 * still read for back-compat with workflows authored by the v1 builder.
 */
export interface Step {
  id?: string;
  type: string;
  config?: Record<string, unknown>;
  condition?: StepCondition; // for if_else
  branches?: { yes?: Step[]; no?: Step[]; buckets?: Step[][] };
  weights?: number[]; // for split
  // legacy v1 fields
  agentId?: string | null;
  text?: string | null;
}

/** Returned by an action handler to feed results back into the run. */
export interface ActionResult {
  /** merge into context.vars */
  vars?: Record<string, unknown>;
  /** true if this step sent a reply to the customer (suppresses duplicate AI auto-reply) */
  repliedExternally?: boolean;
  /** abort the rest of this run (e.g. "remove from workflow") */
  stop?: boolean;
}

/** Read-only view assembled once per execution segment for template + condition resolution. */
export interface Scope {
  trigger: WorkflowContext;
  contact?: Record<string, unknown> | null;
  deal?: Record<string, unknown> | null;
  company?: Record<string, unknown> | null;
  vars: Record<string, unknown>;
  customValue: Record<string, string>;
}

export interface ActionContext {
  workspaceId: string;
  ctx: WorkflowContext;
  scope: Scope;
  /** resolve {{merge.fields}} in a string against the current scope */
  render: (tpl: string | undefined | null) => string;
}

export type ActionHandler = (config: Record<string, unknown>, ac: ActionContext) => Promise<ActionResult | void>;
