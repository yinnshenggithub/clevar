"use client";

import Link from "next/link";
import { useTransition } from "react";
import { Trash2, Calendar, User } from "lucide-react";
import { toggleTask, deleteTask } from "@/lib/actions/tasks";
import { cn } from "@/lib/utils";

export function TaskItem({
  task,
  assigneeName,
  parentHref,
  parentLabel,
}: {
  task: { id: string; title: string; status: string; dueAt: string | null };
  assigneeName?: string;
  parentHref?: string;
  parentLabel?: string;
}) {
  const [pending, start] = useTransition();
  const done = task.status === "DONE";
  const due = task.dueAt ? new Date(task.dueAt) : null;
  const overdue = due && !done && due.getTime() < Date.now();

  return (
    <div className="flex items-start gap-2 rounded-md border border-border p-2.5">
      <input
        type="checkbox"
        checked={done}
        disabled={pending}
        onChange={() => start(() => void toggleTask(task.id))}
        className="mt-0.5 h-4 w-4 shrink-0"
        aria-label={done ? "Mark not done" : "Mark done"}
      />
      <div className="min-w-0 flex-1">
        <div className={cn("text-sm", done && "text-muted-foreground line-through")}>{task.title}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          {due && (
            <span className={cn("inline-flex items-center gap-1", overdue && "text-destructive")}>
              <Calendar className="h-3 w-3" />
              {due.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
            </span>
          )}
          {assigneeName && (
            <span className="inline-flex items-center gap-1">
              <User className="h-3 w-3" />
              {assigneeName}
            </span>
          )}
          {parentHref && parentLabel && (
            <Link href={parentHref} className="underline hover:text-foreground">
              {parentLabel}
            </Link>
          )}
        </div>
      </div>
      <button
        type="button"
        aria-label="Delete task"
        disabled={pending}
        onClick={() => start(() => void deleteTask(task.id))}
        className="text-muted-foreground hover:text-destructive"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
