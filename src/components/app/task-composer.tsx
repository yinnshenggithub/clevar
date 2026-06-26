"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import type { ObjectType } from "@prisma/client";
import { createTask, type TaskState } from "@/lib/actions/tasks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

export function TaskComposer({
  parentType,
  parentId,
  members,
  compact = true,
}: {
  parentType?: ObjectType;
  parentId?: string;
  members: { id: string; name: string }[];
  compact?: boolean;
}) {
  const [state, formAction, pending] = useActionState<TaskState, FormData>(createTask, {});
  const [open, setOpen] = useState(!compact);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) {
      ref.current?.reset();
      if (compact) setOpen(false);
    }
  }, [state, compact]);

  if (compact && !open) {
    return (
      <Button type="button" variant="outline" size="sm" className="gap-1" onClick={() => setOpen(true)}>
        <Plus className="h-3.5 w-3.5" /> Add task
      </Button>
    );
  }

  return (
    <form ref={ref} action={formAction} className="space-y-2 rounded-lg border border-border p-3">
      {parentType && <input type="hidden" name="parentType" value={parentType} />}
      {parentId && <input type="hidden" name="parentId" value={parentId} />}
      <Input name="title" required placeholder="Task title…" />
      <div className="flex flex-wrap gap-2">
        <Input name="dueAt" type="datetime-local" className="w-52" />
        <Select name="assigneeId" className="w-44">
          <option value="">Unassigned</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </Select>
      </div>
      {state.error && <p className="text-xs text-destructive">{state.error}</p>}
      <div className="flex justify-end gap-2">
        {compact && (
          <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        )}
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Adding…" : "Add task"}
        </Button>
      </div>
    </form>
  );
}
