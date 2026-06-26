"use client";

import { useTransition } from "react";
import type { ConversationStatus, ConversationPriority } from "@prisma/client";
import {
  setConversationStatus,
  setConversationPriority,
  snoozeConversation,
  assignConversationUser,
} from "@/lib/actions/inbox";
import { Select } from "@/components/ui/select";

const SNOOZE_OPTIONS: { label: string; minutes: number }[] = [
  { label: "1 hour", minutes: 60 },
  { label: "3 hours", minutes: 180 },
  { label: "8 hours", minutes: 480 },
  { label: "Tomorrow", minutes: 60 * 24 },
  { label: "3 days", minutes: 60 * 24 * 3 },
  { label: "1 week", minutes: 60 * 24 * 7 },
];

export function ConversationControls({
  conversationId,
  status,
  priority,
  assignedUserId,
  members,
}: {
  conversationId: string;
  status: ConversationStatus;
  priority: ConversationPriority;
  assignedUserId: string | null;
  members: { id: string; name: string }[];
}) {
  const [pending, start] = useTransition();

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Select
        aria-label="Status"
        value={status}
        disabled={pending}
        className="h-8 w-28 text-xs"
        onChange={(e) => start(() => void setConversationStatus(conversationId, e.target.value as ConversationStatus))}
      >
        <option value="OPEN">Open</option>
        <option value="PENDING">Pending</option>
        <option value="RESOLVED">Resolved</option>
        {status === "SNOOZED" && <option value="SNOOZED">Snoozed</option>}
      </Select>

      <Select
        aria-label="Snooze"
        value=""
        disabled={pending}
        className="h-8 w-24 text-xs"
        onChange={(e) => {
          const m = Number(e.target.value);
          if (m) start(() => void snoozeConversation(conversationId, m));
        }}
      >
        <option value="">Snooze…</option>
        {SNOOZE_OPTIONS.map((o) => (
          <option key={o.minutes} value={o.minutes}>
            {o.label}
          </option>
        ))}
      </Select>

      <Select
        aria-label="Priority"
        value={priority}
        disabled={pending}
        className="h-8 w-28 text-xs"
        onChange={(e) =>
          start(() => void setConversationPriority(conversationId, e.target.value as ConversationPriority))
        }
      >
        <option value="NONE">No priority</option>
        <option value="LOW">Low</option>
        <option value="MEDIUM">Medium</option>
        <option value="HIGH">High</option>
        <option value="URGENT">Urgent</option>
      </Select>

      <Select
        aria-label="Assignee"
        value={assignedUserId ?? ""}
        disabled={pending}
        className="h-8 w-36 text-xs"
        onChange={(e) => start(() => void assignConversationUser(conversationId, e.target.value))}
      >
        <option value="">Unassigned</option>
        {members.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </Select>
    </div>
  );
}

const PRIORITY_STYLES: Record<ConversationPriority, string> = {
  NONE: "",
  LOW: "bg-sky-500/15 text-sky-600 dark:text-sky-300",
  MEDIUM: "bg-amber-500/15 text-amber-600 dark:text-amber-300",
  HIGH: "bg-orange-500/15 text-orange-600 dark:text-orange-300",
  URGENT: "bg-red-500/15 text-red-600 dark:text-red-300",
};

export function PriorityDot({ priority }: { priority: ConversationPriority }) {
  if (priority === "NONE") return null;
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${PRIORITY_STYLES[priority]}`}>
      {priority.toLowerCase()}
    </span>
  );
}

const STATUS_LABEL: Record<ConversationStatus, string> = {
  OPEN: "",
  PENDING: "pending",
  SNOOZED: "snoozed",
  RESOLVED: "resolved",
};

export function StatusTag({ status }: { status: ConversationStatus }) {
  const label = STATUS_LABEL[status];
  if (!label) return null;
  return <span className="text-[10px] uppercase text-muted-foreground">{label}</span>;
}
