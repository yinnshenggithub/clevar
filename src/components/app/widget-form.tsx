"use client";

import { useActionState } from "react";
import { saveWidget, type WidgetState } from "@/lib/actions/widget";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";

export function WidgetForm({
  agents,
  defaults,
}: {
  agents: { id: string; name: string }[];
  defaults?: { name: string; color: string; welcomeMessage: string; autoReplyAgentId: string | null; enabled: boolean };
}) {
  const [state, formAction, pending] = useActionState<WidgetState, FormData>(saveWidget, {});

  return (
    <form action={formAction} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="w-name">Widget title</Label>
          <Input id="w-name" name="name" defaultValue={defaults?.name ?? "Chat with us"} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="w-color">Accent color</Label>
          <Input id="w-color" name="color" type="color" defaultValue={defaults?.color ?? "#FF7A59"} className="h-10 w-20 p-1" />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="w-welcome">Welcome message</Label>
        <Textarea id="w-welcome" name="welcomeMessage" rows={2} defaultValue={defaults?.welcomeMessage ?? "Hi! How can we help?"} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="w-agent">AI auto-reply agent (optional)</Label>
        <Select id="w-agent" name="autoReplyAgentId" defaultValue={defaults?.autoReplyAgentId ?? ""}>
          <option value="">No auto-reply</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </Select>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="enabled" defaultChecked={defaults?.enabled ?? true} className="h-4 w-4" />
        Widget enabled
      </label>
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      {state.ok && <p className="text-sm text-emerald-600">Saved.</p>}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save widget"}
      </Button>
    </form>
  );
}
