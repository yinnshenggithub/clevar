"use client";

import { useActionState, useEffect, useState } from "react";
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
import { Plus, Trash2 } from "lucide-react";
import type { FormState } from "@/lib/actions/workflows";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const TRIGGERS = [
  { value: "message_received", label: "WhatsApp message received" },
  { value: "contact_created", label: "Contact created" },
  { value: "deal_created", label: "Deal created" },
  { value: "deal_stage_changed", label: "Deal stage changed" },
];
const FIELDS = [
  { value: "", label: "Always (no condition)" },
  { value: "message", label: "Message text" },
  { value: "phone", label: "Customer phone" },
  { value: "stage", label: "Deal stage" },
  { value: "name", label: "Record name" },
];
const ACTIONS = [
  { value: "assign_agent", label: "Assign AI agent (auto-reply)" },
  { value: "send_reply", label: "Send WhatsApp reply" },
  { value: "add_note", label: "Add a note" },
];

type StepT = { id: string; type: string; agentId: string; text: string };

export interface CanvasDefaults {
  name?: string;
  enabled?: boolean;
  triggerType?: string;
  conditionField?: string | null;
  conditionOp?: string | null;
  conditionValue?: string | null;
  steps?: { type: string; agentId?: string | null; text?: string | null }[];
}

const label = (list: { value: string; label: string }[], v: string) =>
  list.find((x) => x.value === v)?.label ?? v;

function NodeBox({ kind, title, body, selected }: { kind: string; title: string; body: string; selected: boolean }) {
  return (
    <div
      className={cn(
        "w-56 rounded-lg border bg-card px-3 py-2 text-left shadow-sm",
        selected ? "border-primary ring-2 ring-primary/30" : "border-border",
      )}
    >
      <div className="text-[10px] font-semibold uppercase tracking-wide text-primary">{title}</div>
      <div className="truncate text-sm font-medium">{kind}</div>
      <div className="truncate text-xs text-muted-foreground">{body}</div>
    </div>
  );
}

export function WorkflowCanvas({
  action,
  agents,
  defaults,
  submitLabel,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  agents: { id: string; name: string }[];
  defaults?: CanvasDefaults;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, {});
  const router = useRouter();

  const [name, setName] = useState(defaults?.name ?? "");
  const [enabled, setEnabled] = useState(defaults?.enabled ?? true);
  const [trigger, setTrigger] = useState({
    triggerType: defaults?.triggerType ?? "message_received",
    conditionField: defaults?.conditionField ?? "",
    conditionOp: defaults?.conditionOp ?? "contains",
    conditionValue: defaults?.conditionValue ?? "",
  });
  const [steps, setSteps] = useState<StepT[]>(
    defaults?.steps?.length
      ? defaults.steps.map((s) => ({ id: crypto.randomUUID(), type: s.type, agentId: s.agentId ?? "", text: s.text ?? "" }))
      : [{ id: crypto.randomUUID(), type: "assign_agent", agentId: "", text: "" }],
  );
  const [selected, setSelected] = useState<string>("trigger");

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  // Rebuild the graph when structure/content changes.
  const sig = JSON.stringify({ trigger, steps: steps.map((s) => [s.id, s.type, s.agentId, s.text]), selected });
  useEffect(() => {
    const ns: Node[] = [
      {
        id: "trigger",
        position: { x: 60, y: 0 },
        draggable: false,
        data: {
          label: (
            <NodeBox
              kind={label(TRIGGERS, trigger.triggerType)}
              title="When"
              body={trigger.conditionField ? `if ${trigger.conditionField} ${trigger.conditionOp} “${trigger.conditionValue}”` : "no condition"}
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
          label: (
            <NodeBox
              kind={label(ACTIONS, s.type)}
              title={i === 0 ? "Then" : "And"}
              body={s.type === "assign_agent" ? agents.find((a) => a.id === s.agentId)?.name ?? "pick agent" : s.text || "set text"}
              selected={selected === s.id}
            />
          ),
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
    const id = crypto.randomUUID();
    setSteps((s) => [...s, { id, type: "add_note", agentId: "", text: "" }]);
    setSelected(id);
  };
  const removeStep = (id: string) => {
    setSteps((s) => (s.length > 1 ? s.filter((x) => x.id !== id) : s));
    setSelected("trigger");
  };
  const updateStep = (id: string, patch: Partial<StepT>) =>
    setSteps((s) => s.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  const selectedStep = steps.find((s) => s.id === selected);

  return (
    <form action={formAction} className="space-y-4">
      {/* hidden serialized state */}
      <input type="hidden" name="triggerType" value={trigger.triggerType} />
      <input type="hidden" name="conditionField" value={trigger.conditionField} />
      <input type="hidden" name="conditionOp" value={trigger.conditionOp} />
      <input type="hidden" name="conditionValue" value={trigger.conditionValue} />
      <input
        type="hidden"
        name="steps"
        value={JSON.stringify(steps.map((s) => ({ type: s.type, agentId: s.agentId, text: s.text })))}
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-2">
          <Label htmlFor="name">Workflow name</Label>
          <Input id="name" name="name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="WhatsApp auto-responder" />
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" name="enabled" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-4 w-4" />
          Enabled
        </label>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
        <div className="h-[460px] rounded-xl border border-border bg-secondary/30">
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
          <div className="flex justify-center pb-3">
            <Button type="button" variant="outline" size="sm" className="gap-2" onClick={addStep}>
              <Plus className="h-4 w-4" /> Add action
            </Button>
          </div>
        </div>

        {/* Editor panel for the selected node */}
        <div className="space-y-4 rounded-xl border border-border p-4">
          {selected === "trigger" ? (
            <>
              <div className="text-sm font-semibold">Trigger</div>
              <div className="space-y-2">
                <Label>When</Label>
                <Select value={trigger.triggerType} onChange={(e) => setTrigger({ ...trigger, triggerType: e.target.value })}>
                  {TRIGGERS.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Condition</Label>
                <Select value={trigger.conditionField} onChange={(e) => setTrigger({ ...trigger, conditionField: e.target.value })}>
                  {FIELDS.map((f) => (
                    <option key={f.value} value={f.value}>{f.label}</option>
                  ))}
                </Select>
                {trigger.conditionField && (
                  <div className="flex gap-2">
                    <Select value={trigger.conditionOp} onChange={(e) => setTrigger({ ...trigger, conditionOp: e.target.value })} className="w-32">
                      <option value="contains">contains</option>
                      <option value="equals">equals</option>
                    </Select>
                    <Input value={trigger.conditionValue} onChange={(e) => setTrigger({ ...trigger, conditionValue: e.target.value })} placeholder="value" />
                  </div>
                )}
              </div>
            </>
          ) : selectedStep ? (
            <>
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold">Action</div>
                <button type="button" onClick={() => removeStep(selectedStep.id)} className="text-destructive hover:opacity-70" aria-label="Remove action">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <div className="space-y-2">
                <Label>Do</Label>
                <Select value={selectedStep.type} onChange={(e) => updateStep(selectedStep.id, { type: e.target.value })}>
                  {ACTIONS.map((a) => (
                    <option key={a.value} value={a.value}>{a.label}</option>
                  ))}
                </Select>
              </div>
              {selectedStep.type === "assign_agent" ? (
                <div className="space-y-2">
                  <Label>AI agent</Label>
                  <Select value={selectedStep.agentId} onChange={(e) => updateStep(selectedStep.id, { agentId: e.target.value })}>
                    <option value="">Select an agent…</option>
                    {agents.map((a) => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </Select>
                  {agents.length === 0 && <p className="text-xs text-muted-foreground">Create an AI agent first.</p>}
                </div>
              ) : (
                <div className="space-y-2">
                  <Label>{selectedStep.type === "send_reply" ? "Reply message" : "Note text"}</Label>
                  <Textarea rows={3} value={selectedStep.text} onChange={(e) => updateStep(selectedStep.id, { text: e.target.value })} />
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Select a node to edit it.</p>
          )}
        </div>
      </div>

      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      <div className="flex gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </Button>
        <Button type="button" variant="ghost" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
