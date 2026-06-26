"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { createMacro, type MacroState, type MacroActionType } from "@/lib/actions/macros";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

type Row = { type: MacroActionType; value: string };

const TYPE_LABELS: Record<MacroActionType, string> = {
  send_reply: "Send reply",
  add_note: "Add internal note",
  add_label: "Add label",
  set_status: "Set status",
  set_priority: "Set priority",
  assign_user: "Assign to",
};

export function MacroForm({
  labels,
  members,
}: {
  labels: { id: string; name: string }[];
  members: { id: string; name: string }[];
}) {
  const [state, formAction, pending] = useActionState<MacroState, FormData>(createMacro, {});
  const [rows, setRows] = useState<Row[]>([{ type: "send_reply", value: "" }]);
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) {
      ref.current?.reset();
      setRows([{ type: "send_reply", value: "" }]);
    }
  }, [state]);

  const update = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const valueField = (r: Row, i: number) => {
    switch (r.type) {
      case "send_reply":
      case "add_note":
        return (
          <Input
            value={r.value}
            onChange={(e) => update(i, { value: e.target.value })}
            placeholder={r.type === "send_reply" ? "Message to send…" : "Internal note…"}
          />
        );
      case "add_label":
        return (
          <Select value={r.value} onChange={(e) => update(i, { value: e.target.value })}>
            <option value="">Choose label…</option>
            {labels.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        );
      case "set_status":
        return (
          <Select value={r.value} onChange={(e) => update(i, { value: e.target.value })}>
            <option value="">Choose…</option>
            <option value="OPEN">Open</option>
            <option value="PENDING">Pending</option>
            <option value="RESOLVED">Resolved</option>
          </Select>
        );
      case "set_priority":
        return (
          <Select value={r.value} onChange={(e) => update(i, { value: e.target.value })}>
            <option value="">Choose…</option>
            <option value="NONE">No priority</option>
            <option value="LOW">Low</option>
            <option value="MEDIUM">Medium</option>
            <option value="HIGH">High</option>
            <option value="URGENT">Urgent</option>
          </Select>
        );
      case "assign_user":
        return (
          <Select value={r.value} onChange={(e) => update(i, { value: e.target.value })}>
            <option value="">Choose member…</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        );
    }
  };

  return (
    <form
      ref={ref}
      action={(fd) => {
        fd.set("actions", JSON.stringify(rows.filter((r) => r.value)));
        return formAction(fd);
      }}
      className="space-y-3"
    >
      <div className="space-y-2">
        <Label htmlFor="macro-name">Macro name</Label>
        <Input id="macro-name" name="name" required placeholder="Resolve & thank" />
      </div>

      <div className="space-y-2">
        <Label>Actions (run top to bottom)</Label>
        {rows.map((r, i) => (
          <div key={i} className="flex items-center gap-2">
            <Select
              value={r.type}
              className="w-44 shrink-0"
              onChange={(e) => update(i, { type: e.target.value as MacroActionType, value: "" })}
            >
              {(Object.keys(TYPE_LABELS) as MacroActionType[]).map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
            <div className="flex-1">{valueField(r, i)}</div>
            <button
              type="button"
              aria-label="Remove action"
              className="text-muted-foreground hover:text-destructive"
              onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((_, idx) => idx !== i) : rs))}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1"
          onClick={() => setRows((rs) => [...rs, { type: "send_reply", value: "" }])}
        >
          <Plus className="h-3.5 w-3.5" /> Add action
        </Button>
      </div>

      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      {state.ok && <p className="text-sm text-emerald-600">Macro saved.</p>}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Create macro"}
      </Button>
    </form>
  );
}
