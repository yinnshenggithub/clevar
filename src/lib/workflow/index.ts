import "server-only";
import type { Prisma, Workflow } from "@prisma/client";
import { prisma } from "../prisma";
import { withTenant } from "../tenant";
import { compile, execute } from "./engine";
import type { Step, StepCondition, WorkflowContext } from "./types";

export type { WorkflowContext } from "./types";
export type TriggerType = string;
export { TRIGGER_DEFS, triggerGroups, isTrigger } from "./triggers";
export { ACTION_DEFS, actionGroups, isAction } from "./actions";

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
