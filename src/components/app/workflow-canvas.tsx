"use client";

import { useActionState, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, ChevronUp, ChevronDown, GitBranch, Shuffle, Clock, Zap } from "lucide-react";
import type { FormState } from "@/lib/actions/workflows";
import {
  triggerGroups,
  actionGroups,
  getActionMeta,
  getTrigger,
  conditionFieldsFor,
  CONDITION_OPS,
  type ActionField,
} from "@/lib/workflow/catalog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

// ─────────────────────────────── types ───────────────────────────────────────

export interface CanvasStep {
  id?: string;
  type: string;
  config?: Record<string, unknown>;
  condition?: Cond;
  weights?: number[];
  branches?: { yes?: CanvasStep[]; no?: CanvasStep[]; buckets?: CanvasStep[][] };
  // legacy v1
  agentId?: string | null;
  text?: string | null;
}

export interface RefData {
  agents: { id: string; name: string }[];
  members: { id: string; name: string }[];
  pipelines: { id: string; name: string }[];
  stages: { id: string; name: string; pipelineId: string }[];
}

export interface CanvasDefaults {
  name?: string;
  enabled?: boolean;
  triggerType?: string;
  conditionField?: string | null;
  conditionOp?: string | null;
  conditionValue?: string | null;
  steps?: CanvasStep[];
}

interface Cond {
  field: string;
  op: string;
  value?: string;
}
interface BStep {
  id: string;
  type: string;
  config: Record<string, unknown>;
  condition?: Cond;
  weights?: number[];
  branches?: { yes: BStep[]; no: BStep[]; buckets: BStep[][] };
}

const VALUELESS_OPS = new Set(["exists", "not_exists", "is_true", "is_false"]);
const MAX_DEPTH = 5;

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function newStep(type: string): BStep {
  const s: BStep = { id: uid(), type, config: {} };
  if (type === "if_else") {
    s.condition = { field: "", op: "contains", value: "" };
    s.branches = { yes: [], no: [], buckets: [] };
  } else if (type === "split") {
    s.weights = [1, 1];
    s.branches = { yes: [], no: [], buckets: [[], []] };
  }
  return s;
}

function hydrate(steps: CanvasStep[] | undefined): BStep[] {
  return (steps ?? []).map((s) => {
    const config = { ...(s.config ?? {}) };
    if (s.agentId && config.agentId == null) config.agentId = s.agentId;
    if (s.text && config.text == null) config.text = s.text;
    const out: BStep = { id: s.id || uid(), type: s.type, config };
    if (s.type === "if_else") {
      out.condition = s.condition ?? { field: "", op: "contains", value: "" };
      out.branches = { yes: hydrate(s.branches?.yes), no: hydrate(s.branches?.no), buckets: [] };
    } else if (s.type === "split") {
      const buckets = (s.branches?.buckets ?? [[], []]).map(hydrate);
      out.weights = s.weights && s.weights.length === buckets.length ? s.weights : buckets.map(() => 1);
      out.branches = { yes: [], no: [], buckets };
    }
    return out;
  });
}

function serialize(steps: BStep[]): CanvasStep[] {
  return steps.map((s) => {
    const base: CanvasStep = { id: s.id, type: s.type, config: s.config };
    if (s.type === "if_else") {
      base.condition = s.condition;
      base.branches = { yes: serialize(s.branches?.yes ?? []), no: serialize(s.branches?.no ?? []) };
    } else if (s.type === "split") {
      base.weights = s.weights;
      base.branches = { buckets: (s.branches?.buckets ?? []).map(serialize) };
    }
    return base;
  });
}

// ─────────────────────────── field input ─────────────────────────────────────

function FieldInput({ refData, step, field, set }: { refData: RefData; step: BStep; field: ActionField; set: (k: string, v: unknown) => void }) {
  const val = step.config[field.name];
  const onChange = (v: unknown) => set(field.name, v);
  switch (field.type) {
    case "textarea":
      return <Textarea rows={2} value={String(val ?? "")} onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder} />;
    case "number":
      return <Input type="number" value={val == null ? "" : String(val)} onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder} />;
    case "boolean":
      return (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4" checked={val === true || val === "true"} onChange={(e) => onChange(e.target.checked)} /> {field.label}
        </label>
      );
    case "select":
    case "status":
    case "priority":
      return (
        <Select value={String(val ?? "")} onChange={(e) => onChange(e.target.value)}>
          <option value="">Select…</option>
          {field.options?.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </Select>
      );
    case "agent":
      return (
        <Select value={String(val ?? "")} onChange={(e) => onChange(e.target.value)}>
          <option value="">Select an agent…</option>
          {refData.agents.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </Select>
      );
    case "user":
      return (
        <Select value={String(val ?? "")} onChange={(e) => onChange(e.target.value)}>
          <option value="">Unassigned</option>
          {refData.members.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </Select>
      );
    case "pipeline":
      return (
        <Select value={String(val ?? "")} onChange={(e) => onChange(e.target.value)}>
          <option value="">Select a pipeline…</option>
          {refData.pipelines.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </Select>
      );
    case "stage": {
      const pid = step.config.pipelineId as string | undefined;
      const stages = pid ? refData.stages.filter((s) => s.pipelineId === pid) : refData.stages;
      const pipeName = (id: string) => refData.pipelines.find((p) => p.id === id)?.name ?? "";
      return (
        <Select value={String(val ?? "")} onChange={(e) => onChange(e.target.value)}>
          <option value="">Select a stage…</option>
          {stages.map((s) => (
            <option key={s.id} value={s.id}>{pid ? s.name : `${pipeName(s.pipelineId)} · ${s.name}`}</option>
          ))}
        </Select>
      );
    }
    default:
      return <Input value={String(val ?? "")} onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder} />;
  }
}

// ─────────────────────────── condition editor ────────────────────────────────

function ConditionEditor({ cond, condFields, onChange }: { cond: Cond; condFields: string[]; onChange: (c: Cond) => void }) {
  return (
    <div className="space-y-2">
      <Select value={cond.field} onChange={(e) => onChange({ ...cond, field: e.target.value })}>
        <option value="">Select a field…</option>
        {condFields.map((f) => (
          <option key={f} value={f}>{f}</option>
        ))}
      </Select>
      <div className="flex gap-2">
        <Select value={cond.op} onChange={(e) => onChange({ ...cond, op: e.target.value })} className="w-40">
          {CONDITION_OPS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </Select>
        {!VALUELESS_OPS.has(cond.op) && (
          <Input value={cond.value ?? ""} onChange={(e) => onChange({ ...cond, value: e.target.value })} placeholder="value" />
        )}
      </div>
    </div>
  );
}

// ─────────────────────────── add-step picker ─────────────────────────────────

function AddStep({ onAdd, allowBranch }: { onAdd: (type: string) => void; allowBranch: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-muted-foreground"><Plus className="h-3.5 w-3.5" /></span>
      <Select
        value=""
        onChange={(e) => {
          if (e.target.value) onAdd(e.target.value);
          e.target.value = "";
        }}
        className="h-8 max-w-[15rem] text-xs"
      >
        <option value="">Add action…</option>
        {actionGroups().map((g) => (
          <optgroup key={g.group} label={g.group}>
            {g.actions
              .filter((a) => allowBranch || (a.token !== "if_else" && a.token !== "split"))
              .map((a) => (
                <option key={a.token} value={a.token}>{a.label}</option>
              ))}
          </optgroup>
        ))}
      </Select>
    </div>
  );
}

// ─────────────────────────── step list (recursive) ───────────────────────────

function StepList({
  steps,
  refData,
  condFields,
  depth,
  onChange,
}: {
  steps: BStep[];
  refData: RefData;
  condFields: string[];
  depth: number;
  onChange: (steps: BStep[]) => void;
}) {
  const update = (id: string, patch: Partial<BStep>) => onChange(steps.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const remove = (id: string) => onChange(steps.filter((s) => s.id !== id));
  const move = (id: string, dir: -1 | 1) => {
    const i = steps.findIndex((s) => s.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= steps.length) return;
    const next = [...steps];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  return (
    <div className="space-y-2">
      {steps.map((s, i) => (
        <StepCard
          key={s.id}
          step={s}
          refData={refData}
          condFields={condFields}
          depth={depth}
          canUp={i > 0}
          canDown={i < steps.length - 1}
          onChange={(patch) => update(s.id, patch)}
          onRemove={() => remove(s.id)}
          onMove={(d) => move(s.id, d)}
        />
      ))}
      <AddStep allowBranch={depth < MAX_DEPTH} onAdd={(type) => onChange([...steps, newStep(type)])} />
    </div>
  );
}

function Lane({ label, tone, children }: { label: string; tone: string; children: ReactNode }) {
  return (
    <div className={cn("rounded-md border-l-2 pl-3", tone)}>
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}

function StepCard({
  step,
  refData,
  condFields,
  depth,
  canUp,
  canDown,
  onChange,
  onRemove,
  onMove,
}: {
  step: BStep;
  refData: RefData;
  condFields: string[];
  depth: number;
  canUp: boolean;
  canDown: boolean;
  onChange: (patch: Partial<BStep>) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const meta = getActionMeta(step.type);
  const setConfig = (k: string, v: unknown) => onChange({ config: { ...step.config, [k]: v } });
  const setType = (type: string) => {
    const fresh = newStep(type);
    onChange({ type, config: {}, condition: fresh.condition, weights: fresh.weights, branches: fresh.branches });
  };
  const isIf = step.type === "if_else";
  const isSplit = step.type === "split";
  const Icon = isIf ? GitBranch : isSplit ? Shuffle : step.type === "wait" ? Clock : Zap;
  const branches = step.branches ?? { yes: [], no: [], buckets: [] };

  const setBuckets = (buckets: BStep[][], weights?: number[]) =>
    onChange({ branches: { ...branches, buckets }, weights: weights ?? step.weights });

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
        <Icon className="h-4 w-4 shrink-0 text-primary" />
        <Select value={step.type} onChange={(e) => setType(e.target.value)} className="h-8 flex-1 text-sm">
          {actionGroups().map((g) => (
            <optgroup key={g.group} label={g.group}>
              {g.actions
                .filter((a) => depth < MAX_DEPTH || (a.token !== "if_else" && a.token !== "split"))
                .map((a) => (
                  <option key={a.token} value={a.token}>{a.label}</option>
                ))}
            </optgroup>
          ))}
        </Select>
        <button type="button" onClick={() => onMove(-1)} disabled={!canUp} className="text-muted-foreground hover:text-foreground disabled:opacity-30" aria-label="Move up">
          <ChevronUp className="h-4 w-4" />
        </button>
        <button type="button" onClick={() => onMove(1)} disabled={!canDown} className="text-muted-foreground hover:text-foreground disabled:opacity-30" aria-label="Move down">
          <ChevronDown className="h-4 w-4" />
        </button>
        <button type="button" onClick={onRemove} className="text-destructive hover:opacity-70" aria-label="Remove">
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-3 px-3 py-3">
        {/* plain action config */}
        {(meta?.fields ?? []).map((f) => (
          <div key={f.name} className="space-y-1">
            {f.type !== "boolean" && <Label className="text-xs">{f.label}</Label>}
            <FieldInput refData={refData} step={step} field={f} set={setConfig} />
          </div>
        ))}

        {/* if / else */}
        {isIf && (
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Condition</Label>
              <ConditionEditor cond={step.condition ?? { field: "", op: "contains", value: "" }} condFields={condFields} onChange={(c) => onChange({ condition: c })} />
            </div>
            <Lane label="If true" tone="border-emerald-500/60">
              <StepList steps={branches.yes} refData={refData} condFields={condFields} depth={depth + 1} onChange={(yes) => onChange({ branches: { ...branches, yes } })} />
            </Lane>
            <Lane label="If false" tone="border-rose-500/60">
              <StepList steps={branches.no} refData={refData} condFields={condFields} depth={depth + 1} onChange={(no) => onChange({ branches: { ...branches, no } })} />
            </Lane>
          </div>
        )}

        {/* split */}
        {isSplit && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">Each record is hashed to one branch (sticky). Weights set the split ratio.</p>
            {branches.buckets.map((bucket, bi) => (
              <Lane key={bi} label={`Branch ${String.fromCharCode(65 + bi)}`} tone="border-sky-500/60">
                <div className="mb-2 flex items-center gap-2">
                  <Label className="text-xs">Weight</Label>
                  <Input
                    type="number"
                    className="h-8 w-20"
                    value={String(step.weights?.[bi] ?? 1)}
                    onChange={(e) => {
                      const w = [...(step.weights ?? branches.buckets.map(() => 1))];
                      w[bi] = Number(e.target.value) || 0;
                      onChange({ weights: w });
                    }}
                  />
                  {branches.buckets.length > 2 && (
                    <button
                      type="button"
                      className="text-destructive hover:opacity-70"
                      onClick={() => setBuckets(branches.buckets.filter((_, x) => x !== bi), (step.weights ?? []).filter((_, x) => x !== bi))}
                      aria-label="Remove branch"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <StepList
                  steps={bucket}
                  refData={refData}
                  condFields={condFields}
                  depth={depth + 1}
                  onChange={(b) => setBuckets(branches.buckets.map((x, xi) => (xi === bi ? b : x)))}
                />
              </Lane>
            ))}
            {branches.buckets.length < 5 && (
              <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => setBuckets([...branches.buckets, []], [...(step.weights ?? []), 1])}>
                <Plus className="h-3.5 w-3.5" /> Add branch
              </Button>
            )}
          </div>
        )}

        {!isIf && !isSplit && (meta?.fields ?? []).length === 0 && <p className="text-xs text-muted-foreground">No configuration needed.</p>}
      </div>
    </div>
  );
}

// ─────────────────────────── main builder ────────────────────────────────────

export function WorkflowCanvas({
  action,
  refData,
  defaults,
  submitLabel,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  refData: RefData;
  defaults?: CanvasDefaults;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, {});
  const router = useRouter();

  const [name, setName] = useState(defaults?.name ?? "");
  const [enabled, setEnabled] = useState(defaults?.enabled ?? true);
  const [triggerType, setTriggerType] = useState(defaults?.triggerType ?? "contact_created");
  const [useFilter, setUseFilter] = useState(Boolean(defaults?.conditionField && defaults?.conditionValue));
  const [conditionField, setConditionField] = useState(defaults?.conditionField ?? "");
  const [conditionOp, setConditionOp] = useState(defaults?.conditionOp ?? "contains");
  const [conditionValue, setConditionValue] = useState(defaults?.conditionValue ?? "");
  const [steps, setSteps] = useState<BStep[]>(() => {
    const h = hydrate(defaults?.steps);
    return h.length ? h : [newStep("add_note")];
  });

  const condFields = useMemo(() => conditionFieldsFor(triggerType), [triggerType]);
  const stepsPayload = JSON.stringify(serialize(steps));
  const trig = getTrigger(triggerType);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="triggerType" value={triggerType} />
      <input type="hidden" name="conditionField" value={useFilter ? conditionField : ""} />
      <input type="hidden" name="conditionOp" value={useFilter ? conditionOp : ""} />
      <input type="hidden" name="conditionValue" value={useFilter ? conditionValue : ""} />
      <input type="hidden" name="steps" value={stepsPayload} />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-2">
          <Label htmlFor="name">Workflow name</Label>
          <Input id="name" name="name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="New-lead nurture" />
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" name="enabled" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-4 w-4" /> Enabled
        </label>
      </div>

      <div className="mx-auto max-w-2xl space-y-2">
        {/* Trigger card */}
        <div className="rounded-lg border border-primary/40 bg-primary/5">
          <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
            <Zap className="h-4 w-4 text-primary" />
            <span className="text-[11px] font-semibold uppercase tracking-wide text-primary">When this happens</span>
          </div>
          <div className="space-y-3 px-3 py-3">
            <Select value={triggerType} onChange={(e) => setTriggerType(e.target.value)}>
              {triggerGroups().map((g) => (
                <optgroup key={g.group} label={g.group}>
                  {g.triggers.map((t) => (
                    <option key={t.token} value={t.token}>{t.label}</option>
                  ))}
                </optgroup>
              ))}
            </Select>
            {trig?.hint && <p className="text-xs text-muted-foreground">{trig.hint}</p>}
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4" checked={useFilter} onChange={(e) => setUseFilter(e.target.checked)} /> Only run if…
            </label>
            {useFilter && (
              <ConditionEditor
                cond={{ field: conditionField, op: conditionOp, value: conditionValue }}
                condFields={condFields}
                onChange={(c) => {
                  setConditionField(c.field);
                  setConditionOp(c.op);
                  setConditionValue(c.value ?? "");
                }}
              />
            )}
          </div>
        </div>

        <div className="flex justify-center py-0.5 text-muted-foreground">↓</div>

        <StepList steps={steps} refData={refData} condFields={condFields} depth={0} onChange={setSteps} />
      </div>

      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      <div className="flex gap-3">
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : submitLabel}</Button>
        <Button type="button" variant="ghost" onClick={() => router.back()}>Cancel</Button>
      </div>
    </form>
  );
}
