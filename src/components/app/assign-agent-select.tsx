"use client";

import { useTransition } from "react";
import { assignAgent } from "@/lib/actions/inbox";
import { Select } from "@/components/ui/select";

export function AssignAgentSelect({
  conversationId,
  agents,
  current,
}: {
  conversationId: string;
  agents: { id: string; name: string }[];
  current: string | null;
}) {
  const [pending, start] = useTransition();
  return (
    <Select
      defaultValue={current ?? ""}
      disabled={pending}
      aria-label="Auto-reply agent"
      className="h-8 w-44 text-xs"
      onChange={(e) => {
        const v = e.target.value;
        start(() => {
          void assignAgent(conversationId, v);
        });
      }}
    >
      <option value="">No AI auto-reply</option>
      {agents.map((a) => (
        <option key={a.id} value={a.id}>
          Auto-reply: {a.name}
        </option>
      ))}
    </Select>
  );
}
