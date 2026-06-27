"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ReactFlow,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Plus, Trash2, ChevronUp, ChevronDown } from "lucide-react";
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

export interface CanvasStep {
  id?: string;
  type: string;
  config?: Record<string, unknown>;
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

type StepT = { id: string; type: string; config: Record<string, unknown> };

const VALUELESS_OPS = new Set(["exists", "not_exists", "is_true", "is_false"]);

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function NodeBox({ title, kind, body, selected }: { title: string; kind: string; body: string; selected: boolean }) {
  return (
    <div className={cn("w-56 rounded-lg border bg-card px-3 py-2 text-left shadow-sm", selected ? "border-primary ring-2 ring-primary/30" : "border-border")}>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-primary">{title}</div>
      <div className="truncate text-sm font-medium">{kind}</div>
      <div className="truncate text-xs text-muted-foreground">{body}</div>
    </div>
  );
}

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

  const [steps, setSteps] = useState<StepT[]>(
    defaults?.steps?.length
      ? defaults.steps.map((s) => ({ id: uid(), type: s.type, config: { ...(s.config ?? {}) } }))
      : [{ id: uid(), type: "add_note", config: {} }],
  );
  const [selected, setSelected] = useState<string>("trigger");

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  const triggerLabel = getTrigger(triggerType)?.label ?? triggerType;
  const condFields = useMemo(() => conditionFieldsFor(triggerType), [triggerType]);

  const stepSummary = (s: StepT) => {
    const meta = getActionMeta(s.type);
    if (!meta) return "configure";
    if (s.type === "assign_agent") return refData.agents.find((a) => a.id === s.config.agentId)?.name ?? "pick agent";
    if (s.type === "wait") return `${s.config.amount ?? 0} ${s.config.unit ?? "minutes"}`;
    const first = meta.fields?.[0];
    if (first) {
      const v = s.config[first.name];
      if (v) return `${first.label}: ${String(v).slice(0, 24)}`;
    }
    return meta.label;
  };

  const sig = JSON.stringify({ triggerType, useFilter, conditionField, conditionOp, conditionValue, steps, selected });
  useEffect(() => {
    const ns: Node[] = [
      {
        id: "trigger",
        position: { x: 60, y: 0 },
        draggable: false,
        data: {
          label: (
            <NodeBox
              title="When"
              kind={triggerLabel}
              body={useFilter && conditionField ? `if ${conditionField.split(".").pop()} ${conditionOp}` : "no filter"}
              selected={selected === "trigger"}
            />
          ),
        },
      },
    ];
    steps.forEach((s, i) => {
      ns.push({
        id: s.id,
        position: { x: 60, y: 120 * (i + 1) },
        draggable: false,
        data: {
          label: <NodeBox title={i === 0 ? "Then" : "And"} kind={getActionMeta(s.type)?.label ?? s.type} body={stepSummary(s)} selected={selected === s.id} />,
        },
      });
    });
    const es: Edge[] = [];
    let prev = "trigger";
    for (const s of steps) {
      es.push({ id: `${prev}-${s.id}`, source: prev, target: s.id, animated: true });
      prev = s.id;
    }
    setNodes(ns);
    setEdges(es);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  const addStep = () => {
    const id = uid();
    setSteps((s) => [...s, { id, type: "add_note", config: {} }]);
    setSelected(id);
  };
  const removeStep = (id: string) => {
    setSteps((s) => (s.length > 1 ? s.filter((x) => x.id !== id) : s));
    setSelected("trigger");
  };
  const moveStep = (id: string, dir: -1 | 1) =>
    setSteps((s) => {
      const i = s.findIndex((x) => x.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= s.length) return s;
      const next = [...s];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const setType = (id: string, type: string) => setSteps((s) => s.map((x) => (x.id === id ? { ...x, type, config: {} } : x)));
  const setConfig = (id: string, key: string, value: unknown) =>
    setSteps((s) => s.map((x) => (x.id === id ? { ...x, config: { ...x.config, [key]: value } } : x)));

  const selectedStep = steps.find((s) => s.id === selected);

  // serialized payload for the server action
  const stepsPayload = JSON.stringify(steps.map((s) => ({ id: s.id, type: s.type, config: s.config })));

  function renderField(step: StepT, f: ActionField) {
    const val = step.config[f.name];
    const set = (v: unknown) => setConfig(step.id, f.name, v);
    switch (f.type) {
      case "textarea":
        return <Textarea rows={3} value={String(val ?? "")} onChange={(e) => set(e.target.value)} placeholder={f.placeholder} />;
      case "number":
        return <Input type="number" value={val == null ? "" : String(val)} onChange={(e) => set(e.target.value)} placeholder={f.placeholder} />;
      case "boolean":
        return (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4" checked={val === true || val === "true"} onChange={(e) => set(e.target.checked)} />
            {f.label}
          </label>
        );
      case "select":
        return (
          <Select value={String(val ?? "")} onChange={(e) => set(e.target.value)}>
            <option value="">Select…</option>
            {f.options?.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </Select>
        );
      case "status":
      case "priority":
        return (
          <Select value={String(val ?? "")} onChange={(e) => set(e.target.value)}>
            <option value="">Select…</option>
            {f.options?.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </Select>
        );
      case "agent":
        return (
          <Select value={String(val ?? "")} onChange={(e) => set(e.target.value)}>
            <option value="">Select an agent…</option>
            {refData.agents.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </Select>
        );
      case "user":
        return (
          <Select value={String(val ?? "")} onChange={(e) => set(e.target.value)}>
            <option value="">Unassigned</option>
            {refData.members.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </Select>
        );
      case "pipeline":
        return (
          <Select value={String(val ?? "")} onChange={(e) => set(e.target.value)}>
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
          <Select value={String(val ?? "")} onChange={(e) => set(e.target.value)}>
            <option value="">Select a stage…</option>
            {stages.map((s) => (
              <option key={s.id} value={s.id}>{pid ? s.name : `${pipeName(s.pipelineId)} · ${s.name}`}</option>
            ))}
          </Select>
        );
      }
      default:
        return <Input value={String(val ?? "")} onChange={(e) => set(e.target.value)} placeholder={f.placeholder} />;
    }
  }

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
          <input type="checkbox" name="enabled" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-4 w-4" />
          Enabled
        </label>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_340px]">
        <div className="rounded-xl border border-border bg-secondary/30">
          <div className="h-[460px]">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onNodeClick={(_, n) => setSelected(n.id)}
              fitView
              proOptions={{ hideAttribution: true }}
              nodesConnectable={false}
            >
              <Background />
              <Controls showInteractive={false} />
            </ReactFlow>
          </div>
          <div className="flex justify-center pb-3">
            <Button type="button" variant="outline" size="sm" className="gap-2" onClick={addStep}>
              <Plus className="h-4 w-4" /> Add action
            </Button>
          </div>
        </div>

        <div className="space-y-4 rounded-xl border border-border p-4">
          {selected === "trigger" ? (
            <>
              <div className="text-sm font-semibold">Trigger</div>
              <div className="space-y-2">
                <Label>When this happens</Label>
                <Select value={triggerType} onChange={(e) => setTriggerType(e.target.value)}>
                  {triggerGroups().map((g) => (
                    <optgroup key={g.group} label={g.group}>
                      {g.triggers.map((t) => (
                        <option key={t.token} value={t.token}>{t.label}</option>
                      ))}
                    </optgroup>
                  ))}
                </Select>
                {getTrigger(triggerType)?.hint && <p className="text-xs text-muted-foreground">{getTrigger(triggerType)!.hint}</p>}
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="h-4 w-4" checked={useFilter} onChange={(e) => setUseFilter(e.target.checked)} />
                Only run if…
              </label>
              {useFilter && (
                <div className="space-y-2">
                  <Select value={conditionField} onChange={(e) => setConditionField(e.target.value)}>
                    <option value="">Select a field…</option>
                    {condFields.map((f) => (
                      <option key={f} value={f}>{f}</option>
                    ))}
                  </Select>
                  <div className="flex gap-2">
                    <Select value={conditionOp} onChange={(e) => setConditionOp(e.target.value)} className="w-40">
                      {CONDITION_OPS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </Select>
                    {!VALUELESS_OPS.has(conditionOp) && (
                      <Input value={conditionValue} onChange={(e) => setConditionValue(e.target.value)} placeholder="value" />
                    )}
                  </div>
                </div>
              )}
            </>
          ) : selectedStep ? (
            <>
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold">Action</div>
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => moveStep(selectedStep.id, -1)} className="text-muted-foreground hover:text-foreground" aria-label="Move up">
                    <ChevronUp className="h-4 w-4" />
                  </button>
                  <button type="button" onClick={() => moveStep(selectedStep.id, 1)} className="text-muted-foreground hover:text-foreground" aria-label="Move down">
                    <ChevronDown className="h-4 w-4" />
                  </button>
                  <button type="button" onClick={() => removeStep(selectedStep.id)} className="text-destructive hover:opacity-70" aria-label="Remove action">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Do this</Label>
                <Select value={selectedStep.type} onChange={(e) => setType(selectedStep.id, e.target.value)}>
                  {actionGroups().map((g) => (
                    <optgroup key={g.group} label={g.group}>
                      {g.actions.map((a) => (
                        <option key={a.token} value={a.token}>{a.label}</option>
                      ))}
                    </optgroup>
                  ))}
                </Select>
              </div>
              {(getActionMeta(selectedStep.type)?.fields ?? []).map((f) => (
                <div key={f.name} className="space-y-1.5">
                  {f.type !== "boolean" && <Label>{f.label}</Label>}
                  {renderField(selectedStep, f)}
                </div>
              ))}
              {(getActionMeta(selectedStep.type)?.fields ?? []).length === 0 && (
                <p className="text-xs text-muted-foreground">No configuration needed.</p>
              )}
              <p className="text-[11px] text-muted-foreground">
                Tip: insert data with <code>{"{{contact.firstName}}"}</code>, <code>{"{{trigger.messageText}}"}</code>, <code>{"{{customValue.key}}"}</code>.
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Select a node to edit it.</p>
          )}
        </div>
      </div>

      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      <div className="flex gap-3">
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : submitLabel}</Button>
        <Button type="button" variant="ghost" onClick={() => router.back()}>Cancel</Button>
      </div>
    </form>
  );
}
