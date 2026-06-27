import "server-only";
import type { Prisma, Workflow } from "@prisma/client";
import { prisma } from "../prisma";
import { withTenant } from "../tenant";
import { compile, execute } from "./engine";
import type { Step, StepCondition, WorkflowContext } from "./types";

export type { WorkflowContext } from "./types";
export type TriggerType = string;
export {
  TRIGGER_DEFS,
  ACTION_META,
  triggerGroups,
  actionGroups,
  isTrigger,
  isAction,
  getTrigger,
  getActionMeta,
  conditionFieldsFor,
  CONDITION_OPS,
} from "./catalog";

/** Parse the stored canvas steps, falling back to the legacy single-action columns. */
function resolveSteps(wf: Workflow): Step[] {
  const raw = wf.steps;
  if (Array.isArray(raw) && raw.length > 0) return raw as unknown as Step[];
  return [{ type: wf.actionType, agentId: wf.actionAgentId, text: wf.actionText }];
}

/** Translate the v1 workflow-level condition columns into a scope condition. */
function legacyGate(wf: Workflow): StepCondition | undefined {
  if (!wf.conditionField || !wf.conditionValue) return undefined;
  const map: Record<string, string> = {
    message: "trigger.messageText",
    phone: "trigger.customerPhone",
    stage: "trigger.stageName",
    name: "trigger.recordName",
  };
  const field = map[wf.conditionField] ?? `trigger.${wf.conditionField}`;
  return { field, op: wf.conditionOp === "equals" ? "equals" : "contains", value: wf.conditionValue };
}

/** ctx is persisted into WorkflowRun.context across a Wait; channel creds are dropped. */
function serializeCtx(ctx: WorkflowContext): Prisma.InputJsonValue {
  const { channel: _drop, ...rest } = ctx;
  return rest as Prisma.InputJsonValue;
}

async function persistWaitingRun(
  workspaceId: string,
  workflowId: string,
  pc: number,
  ctx: WorkflowContext,
  resumeAt: Date,
): Promise<void> {
  try {
    await withTenant(workspaceId, (tx) =>
      tx.workflowRun.create({
        data: { workspaceId, workflowId, status: "WAITING", pc, context: serializeCtx(ctx), resumeAt },
      }),
    );
  } catch (e) {
    console.error("persistWaitingRun failed", workflowId, e);
  }
}

/**
 * Runs every enabled workflow for a trigger. Returns whether any action already
 * sent a customer reply (so the webhook caller can skip a duplicate AI reply).
 * Most runs finish inline; a run that hits a Wait is persisted to workflow_runs
 * and resumed later by the cron route.
 */
export async function runWorkflows(
  workspaceId: string,
  triggerType: TriggerType,
  ctx: WorkflowContext,
): Promise<{ repliedExternally: boolean }> {
  let workflows: Workflow[] = [];
  try {
    workflows = await withTenant(workspaceId, (tx) => tx.workflow.findMany({ where: { triggerType, enabled: true } }));
  } catch (e) {
    console.error("runWorkflows load failed", e);
    return { repliedExternally: false };
  }

  let repliedExternally = false;
  for (const wf of workflows) {
    try {
      // each workflow gets its own ctx copy so steps that re-point contactId/dealId don't leak across workflows
      const wctx: WorkflowContext = { ...ctx, vars: { ...(ctx.vars ?? {}) } };
      const instrs = compile(resolveSteps(wf));
      const out = await execute(workspaceId, instrs, 0, wctx, legacyGate(wf));
      repliedExternally = repliedExternally || out.repliedExternally;
      if (out.status === "WAITING" && out.resumeAt) {
        await persistWaitingRun(workspaceId, wf.id, out.pc, wctx, out.resumeAt);
      }
    } catch (e) {
      console.error("workflow run failed", wf.id, e);
    }
  }
  return { repliedExternally };
}

/** Compile + run a single workflow from the start with no whole-workflow gate (used by scheduled triggers). */
async function runOne(workspaceId: string, wf: Workflow, ctx: WorkflowContext): Promise<void> {
  const instrs = compile(resolveSteps(wf));
  const out = await execute(workspaceId, instrs, 0, ctx, undefined);
  if (out.status === "WAITING" && out.resumeAt) await persistWaitingRun(workspaceId, wf.id, out.pc, ctx, out.resumeAt);
}

/** Parse a scheduled workflow's parameters out of its conditionValue column. */
function schedParams(wf: Workflow): { days?: number; hours?: number; value?: number } {
  const raw = wf.conditionValue;
  if (!raw) return {};
  try {
    const j = JSON.parse(raw);
    if (j && typeof j === "object") return j as { days?: number; hours?: number; value?: number };
  } catch {
    /* not JSON */
  }
  const n = Number(raw);
  return Number.isFinite(n) ? { value: n } : {};
}

const SCHED_RECORD_CAP = 200;

/**
 * Fire schedule-driven triggers. Called by /api/cron on every tick.
 *  - `scheduled`   : runs the workflow once per tick (cadence = the cron schedule).
 *  - `deal_stale`  : OPEN deals untouched for ≥N days (default 14), once per stale span.
 *  - `task_reminder`: tasks due within the next N hours (default 24), once per due date.
 * Idempotency is tracked in the record's customFields (no extra table).
 */
export async function runScheduledTriggers(now: Date = new Date()): Promise<{ fired: number }> {
  let fired = 0;
  const workspaces = await prisma.workspace.findMany({ select: { id: true } });
  for (const ws of workspaces) {
    let workflows: Workflow[] = [];
    try {
      workflows = await withTenant(ws.id, (tx) =>
        tx.workflow.findMany({ where: { enabled: true, triggerType: { in: ["scheduled", "deal_stale", "task_reminder"] } } }),
      );
    } catch (e) {
      console.error("runScheduledTriggers load failed", ws.id, e);
      continue;
    }
    for (const wf of workflows) {
      try {
        if (wf.triggerType === "scheduled") {
          await runOne(ws.id, wf, { vars: {} });
          fired++;
          continue;
        }
        const p = schedParams(wf);
        if (wf.triggerType === "deal_stale") {
          const days = p.days ?? p.value ?? 14;
          const threshold = new Date(now.getTime() - days * 86_400_000);
          const markKey = `__wf_stale_${wf.id}`;
          const deals = await withTenant(ws.id, (tx) =>
            tx.deal.findMany({
              where: { status: "OPEN", deletedAt: null, updatedAt: { lte: threshold } },
              select: { id: true, title: true, updatedAt: true, customFields: true },
              take: SCHED_RECORD_CAP,
            }),
          );
          for (const d of deals) {
            const cf = (d.customFields as Record<string, unknown>) ?? {};
            if (cf[markKey] === d.updatedAt.toISOString()) continue;
            await runOne(ws.id, wf, { dealId: d.id, recordName: d.title, vars: {} });
            await withTenant(ws.id, (tx) =>
              tx.deal.update({ where: { id: d.id }, data: { customFields: { ...cf, [markKey]: d.updatedAt.toISOString() } as Prisma.InputJsonValue } }),
            );
            fired++;
          }
        } else if (wf.triggerType === "task_reminder") {
          const hours = p.hours ?? p.value ?? 24;
          const windowEnd = new Date(now.getTime() + hours * 3_600_000);
          const markKey = `__wf_reminded_${wf.id}`;
          const tasks = await withTenant(ws.id, (tx) =>
            tx.task.findMany({
              where: { status: { not: "DONE" }, dueAt: { gte: now, lte: windowEnd } },
              select: { id: true, title: true, dueAt: true, parentType: true, parentId: true, customFields: true },
              take: SCHED_RECORD_CAP,
            }),
          );
          for (const t of tasks) {
            const cf = (t.customFields as Record<string, unknown>) ?? {};
            const due = t.dueAt?.toISOString() ?? "";
            if (cf[markKey] === due) continue;
            const parent: Partial<WorkflowContext> =
              t.parentType === "CONTACT" && t.parentId
                ? { contactId: t.parentId }
                : t.parentType === "DEAL" && t.parentId
                  ? { dealId: t.parentId }
                  : t.parentType === "COMPANY" && t.parentId
                    ? { companyId: t.parentId }
                    : {};
            await runOne(ws.id, wf, { taskId: t.id, recordName: t.title, ...parent, vars: {} });
            await withTenant(ws.id, (tx) =>
              tx.task.update({ where: { id: t.id }, data: { customFields: { ...cf, [markKey]: due } as Prisma.InputJsonValue } }),
            );
            fired++;
          }
        }
      } catch (e) {
        console.error("scheduled trigger failed", wf.id, e);
      }
    }
  }
  return { fired };
}

/** Resume one persisted run from its saved program counter. */
async function resumeRun(workspaceId: string, runId: string, workflowId: string, pc: number, ctx: WorkflowContext): Promise<void> {
  const wf = await withTenant(workspaceId, (tx) => tx.workflow.findFirst({ where: { id: workflowId } }));
  if (!wf || !wf.enabled) {
    await withTenant(workspaceId, (tx) => tx.workflowRun.update({ where: { id: runId }, data: { status: "CANCELLED" } }));
    return;
  }
  try {
    const instrs = compile(resolveSteps(wf));
    const out = await execute(workspaceId, instrs, pc, ctx, undefined);
    if (out.status === "WAITING" && out.resumeAt) {
      await withTenant(workspaceId, (tx) =>
        tx.workflowRun.update({ where: { id: runId }, data: { pc: out.pc, context: serializeCtx(ctx), resumeAt: out.resumeAt, status: "WAITING" } }),
      );
    } else {
      await withTenant(workspaceId, (tx) => tx.workflowRun.update({ where: { id: runId }, data: { status: "DONE" } }));
    }
  } catch (e) {
    console.error("resumeRun failed", runId, e);
    await withTenant(workspaceId, (tx) =>
      tx.workflowRun.update({ where: { id: runId }, data: { status: "FAILED", lastError: String(e).slice(0, 500), attempts: { increment: 1 } } }),
    );
  }
}

/**
 * Resume all WAITING runs whose resumeAt is due. Called by /api/cron. Workspaces
 * are enumerated on the control plane, then each tenant's due runs are read under
 * its RLS context.
 */
export async function resumeDueRuns(now: Date = new Date(), perWorkspace = 50): Promise<{ resumed: number }> {
  let resumed = 0;
  const workspaces = await prisma.workspace.findMany({ select: { id: true } });
  for (const ws of workspaces) {
    let due: { id: string; workflowId: string; pc: number; context: unknown }[] = [];
    try {
      due = await withTenant(ws.id, (tx) =>
        tx.workflowRun.findMany({
          where: { status: "WAITING", resumeAt: { lte: now } },
          select: { id: true, workflowId: true, pc: true, context: true },
          take: perWorkspace,
        }),
      );
    } catch (e) {
      console.error("resumeDueRuns load failed", ws.id, e);
      continue;
    }
    for (const run of due) {
      // claim the run so a concurrent cron tick won't double-process it
      const claimed = await withTenant(ws.id, (tx) =>
        tx.workflowRun.updateMany({ where: { id: run.id, status: "WAITING" }, data: { status: "RUNNING" } }),
      );
      if (claimed.count === 0) continue;
      const ctx = (run.context ?? {}) as WorkflowContext;
      await resumeRun(ws.id, run.id, run.workflowId, run.pc, ctx);
      resumed++;
    }
  }
  return { resumed };
}
