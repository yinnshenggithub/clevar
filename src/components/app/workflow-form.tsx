"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import type { FormState } from "@/lib/actions/workflows";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const TRIGGERS = [
  { value: "message_received", label: "When a WhatsApp message is received" },
  { value: "contact_created", label: "When a contact is created" },
  { value: "deal_created", label: "When a deal is created" },
  { value: "deal_stage_changed", label: "When a deal changes stage" },
];
const FIELDS = [
  { value: "", label: "Always (no condition)" },
  { value: "message", label: "Message text" },
  { value: "phone", label: "Customer phone" },
  { value: "stage", label: "Deal stage" },
  { value: "name", label: "Record name" },
];
const ACTIONS = [
  { value: "assign_agent", label: "Assign an AI agent (auto-reply)" },
  { value: "send_reply", label: "Send a WhatsApp reply" },
  { value: "add_note", label: "Add a note to the record" },
];

export interface WorkflowDefaults {
  name?: string;
  enabled?: boolean;
  triggerType?: string;
  conditionField?: string | null;
  conditionOp?: string | null;
  conditionValue?: string | null;
  actionType?: string;
  actionAgentId?: string | null;
  actionText?: string | null;
}

export function WorkflowForm({
  action,
  agents,
  defaults,
  submitLabel,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  agents: { id: string; name: string }[];
  defaults?: WorkflowDefaults;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, {});
  const router = useRouter();
  const [actionType, setActionType] = useState(defaults?.actionType ?? "assign_agent");
  const [conditionField, setConditionField] = useState(defaults?.conditionField ?? "");

  return (
    <form action={formAction} className="max-w-2xl space-y-6">
      <div className="space-y-2">
        <Label htmlFor="name">Workflow name</Label>
        <Input id="name" name="name" required defaultValue={defaults?.name ?? ""} placeholder="WhatsApp auto-responder" />
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="enabled" defaultChecked={defaults?.enabled ?? true} className="h-4 w-4" />
        Enabled
      </label>

      <div className="space-y-2">
        <Label htmlFor="triggerType">When (trigger)</Label>
        <Select id="triggerType" name="triggerType" defaultValue={defaults?.triggerType ?? "message_received"}>
          {TRIGGERS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </Select>
      </div>

      <div className="space-y-2 rounded-md border border-border p-4">
        <Label>If (condition)</Label>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Select
            name="conditionField"
            value={conditionField}
            onChange={(e) => setConditionField(e.target.value)}
          >
            {FIELDS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </Select>
          {conditionField && (
            <>
              <Select name="conditionOp" defaultValue={defaults?.conditionOp ?? "contains"}>
                <option value="contains">contains</option>
                <option value="equals">equals</option>
              </Select>
              <Input name="conditionValue" defaultValue={defaults?.conditionValue ?? ""} placeholder="value, e.g. pricing" />
            </>
          )}
        </div>
      </div>

      <div className="space-y-2 rounded-md border border-border p-4">
        <Label htmlFor="actionType">Then (action)</Label>
        <Select id="actionType" name="actionType" value={actionType} onChange={(e) => setActionType(e.target.value)}>
          {ACTIONS.map((a) => (
            <option key={a.value} value={a.value}>
              {a.label}
            </option>
          ))}
        </Select>

        {actionType === "assign_agent" ? (
          <div className="space-y-2">
            <Label htmlFor="actionAgentId">AI agent</Label>
            <Select id="actionAgentId" name="actionAgentId" defaultValue={defaults?.actionAgentId ?? ""}>
              <option value="">Select an agent…</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
            {agents.length === 0 && (
              <p className="text-xs text-muted-foreground">Create an AI agent first to use this action.</p>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            <Label htmlFor="actionText">{actionType === "send_reply" ? "Reply message" : "Note text"}</Label>
            <Textarea id="actionText" name="actionText" rows={3} defaultValue={defaults?.actionText ?? ""} />
          </div>
        )}
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
