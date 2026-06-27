import "server-only";
import { withTenant } from "../tenant";
import { getAction } from "./actions";
import { renderTemplate, evalCondition } from "./template";
import type { Step, StepCondition, WorkflowContext, Scope } from "./types";

// ── compiled instruction set ──────────────────────────────────────────────────
type Instr =
  | { op: "action"; step: Step }
  | { op: "branch"; condition?: StepCondition; elseTarget: number }
  | { op: "jmp"; target: number }
  | { op: "split"; weights: number[]; bucketTargets: number[] }
  | { op: "wait"; ms: number };

const UNIT_MS: Record<string, number> = { minutes: 60_000, hours: 3_600_000, days: 86_400_000 };

function waitMs(config: Record<string, unknown> | undefined): number {
  const amount = Number(config?.amount ?? 0);
  const unit = String(config?.unit ?? "minutes");
  const n = Number.isFinite(amount) ? amount : 0;
  return Math.max(0, n) * (UNIT_MS[unit] ?? 60_000);
}

/**
 * Flatten a (possibly branching) step tree into a linear instruction list with
 * resolved jump targets. The flat form gives every position a stable integer
 * program counter, which is what WorkflowRun.pc persists across a Wait.
 */
export function compile(steps: Step[]): Instr[] {
  const instrs: Instr[] = [];
  const labelIndex = new Map<string, number>();
  const gotos: { idx: number; targetId: string }[] = [];

  function emit(list: Step[]): void {
    for (const step of list) {
      if (step.id) labelIndex.set(step.id, instrs.length);
      switch (step.type) {
        case "if_else": {
          const branchIdx = instrs.length;
          instrs.push({ op: "branch", condition: step.condition, elseTarget: -1 });
          emit(step.branches?.yes ?? []);
          const jmpIdx = instrs.length;
          instrs.push({ op: "jmp", target: -1 });
          (instrs[branchIdx] as Extract<Instr, { op: "branch" }>).elseTarget = instrs.length;
          emit(step.branches?.no ?? []);
          (instrs[jmpIdx] as Extract<Instr, { op: "jmp" }>).target = instrs.length;
          break;
        }
        case "split": {
          const buckets = step.branches?.buckets ?? [];
          const weights = step.weights && step.weights.length === buckets.length ? step.weights : buckets.map(() => 1);
          const splitIdx = instrs.length;
          instrs.push({ op: "split", weights, bucketTargets: [] });
          const targets: number[] = [];
          const endJmps: number[] = [];
          for (const bucket of buckets) {
            targets.push(instrs.length);
            emit(bucket);
            endJmps.push(instrs.length);
            instrs.push({ op: "jmp", target: -1 });
          }
          (instrs[splitIdx] as Extract<Instr, { op: "split" }>).bucketTargets = targets;
          const end = instrs.length;
          for (const j of endJmps) (instrs[j] as Extract<Instr, { op: "jmp" }>).target = end;
          break;
        }
        case "wait":
          instrs.push({ op: "wait", ms: waitMs(step.config) });
          break;
        case "goto":
          gotos.push({ idx: instrs.length, targetId: String(step.config?.targetId ?? "") });
          instrs.push({ op: "jmp", target: -1 });
          break;
        default:
          instrs.push({ op: "action", step });
      }
    }
  }

  emit(steps);
  for (const g of gotos) {
    (instrs[g.idx] as Extract<Instr, { op: "jmp" }>).target = labelIndex.get(g.targetId) ?? instrs.length;
  }
  return instrs;
}

/** Merge legacy v1 step fields (agentId/text) into the config bag. */
function legacyConfig(step: Step): Record<string, unknown> {
  const config: Record<string, unknown> = { ...(step.config ?? {}) };
  if (step.agentId != null && config.agentId == null) config.agentId = step.agentId;
  if (step.text != null && config.text == null) config.text = step.text;
  return config;
}

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic bucket for Split: same entity always lands in the same branch. */
function pickBucket(weights: number[], ctx: WorkflowContext): number {
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const key = ctx.contactId || ctx.dealId || ctx.conversationId || "";
  const h = (key ? hashStr(key) : Math.floor(Math.random() * total)) % total;
  let acc = 0;
  for (let i = 0; i < weights.length; i++) {
    acc += weights[i];
    if (h < acc) return i;
  }
  return 0;
}

/** Load the records referenced by ctx + the workspace custom values, once. */
async function buildScope(workspaceId: string, ctx: WorkflowContext): Promise<Scope> {
  const { contact, deal, company, customValue } = await withTenant(workspaceId, async (tx) => {
    const [contact, deal, company, cvs] = await Promise.all([
      ctx.contactId ? tx.contact.findFirst({ where: { id: ctx.contactId } }) : Promise.resolve(null),
      ctx.dealId ? tx.deal.findFirst({ where: { id: ctx.dealId } }) : Promise.resolve(null),
      ctx.companyId ? tx.company.findFirst({ where: { id: ctx.companyId } }) : Promise.resolve(null),
      tx.workspaceCustomValue.findMany({ select: { key: true, value: true } }),
    ]);
    const customValue: Record<string, string> = {};
    for (const c of cvs) customValue[c.key] = c.value;
    return { contact, deal, company, customValue };
  });
  return {
    trigger: ctx,
    contact: contact as Record<string, unknown> | null,
    deal: deal as Record<string, unknown> | null,
    company: company as Record<string, unknown> | null,
    vars: ctx.vars ?? {},
    customValue,
  };
}

export interface ExecOutcome {
  repliedExternally: boolean;
  status: "DONE" | "WAITING";
  pc: number;
  resumeAt?: Date;
}

/**
 * Run a compiled program from `startPc`. Returns DONE, or WAITING (with the pc
 * to resume from + when) if a Wait step is hit. `gate` is an optional
 * whole-workflow condition (the v1 trigger condition) evaluated before step 0.
 */
export async function execute(
  workspaceId: string,
  instrs: Instr[],
  startPc: number,
  ctx: WorkflowContext,
  gate?: StepCondition,
): Promise<ExecOutcome> {
  let scope = await buildScope(workspaceId, ctx);
  if (startPc === 0 && gate && !evalCondition(gate, scope)) {
    return { repliedExternally: false, status: "DONE", pc: instrs.length };
  }
  const render = (tpl: string | undefined | null) => renderTemplate(tpl, scope);
  let pc = Math.max(0, startPc);
  let replied = false;
  let guard = 0;

  while (pc < instrs.length) {
    if (guard++ > 10_000) {
      console.error("workflow exceeded step budget", workspaceId);
      break;
    }
    const ins = instrs[pc];
    if (ins.op === "wait") {
      return { repliedExternally: replied, status: "WAITING", pc: pc + 1, resumeAt: new Date(Date.now() + ins.ms) };
    }
    if (ins.op === "jmp") {
      pc = ins.target;
      continue;
    }
    if (ins.op === "branch") {
      pc = evalCondition(ins.condition, scope) ? pc + 1 : ins.elseTarget;
      continue;
    }
    if (ins.op === "split") {
      pc = ins.bucketTargets[pickBucket(ins.weights, ctx)] ?? instrs.length;
      continue;
    }
    // action
    const def = getAction(ins.step.type);
    if (def?.run) {
      try {
        const res = await def.run(legacyConfig(ins.step), { workspaceId, ctx, scope, render });
        if (res?.vars) {
          ctx.vars = { ...(ctx.vars ?? {}), ...res.vars };
          scope.vars = ctx.vars;
        }
        if (res?.repliedExternally) replied = true;
        if (res?.stop) return { repliedExternally: replied, status: "DONE", pc: instrs.length };
        // records may have changed (or ctx.contactId/dealId re-pointed) → reload scope
        scope = await buildScope(workspaceId, ctx);
      } catch (e) {
        console.error("workflow step failed", ins.step.type, e);
      }
    }
    pc++;
  }
  return { repliedExternally: replied, status: "DONE", pc };
}
