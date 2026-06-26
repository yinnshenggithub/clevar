"use client";

import { useActionState } from "react";
import { connectChannel, type ChannelState } from "@/lib/actions/inbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

export interface ChannelDefaults {
  phoneNumberId?: string;
  displayName?: string;
  wabaId?: string | null;
  autoReplyAgentId?: string | null;
}

export function ChannelForm({
  agents,
  defaults,
}: {
  agents: { id: string; name: string }[];
  defaults?: ChannelDefaults;
}) {
  const [state, formAction, pending] = useActionState<ChannelState, FormData>(connectChannel, {});

  return (
    <form action={formAction} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="phoneNumberId">Phone number ID</Label>
          <Input id="phoneNumberId" name="phoneNumberId" required defaultValue={defaults?.phoneNumberId ?? ""} placeholder="From Meta → WhatsApp → API setup" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="displayName">Display name</Label>
          <Input id="displayName" name="displayName" defaultValue={defaults?.displayName ?? "WhatsApp"} />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="accessToken">Cloud API access token</Label>
        <Input id="accessToken" name="accessToken" type="password" required placeholder="System-user token (paste to set/replace)" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="wabaId">WABA ID (optional)</Label>
          <Input id="wabaId" name="wabaId" defaultValue={defaults?.wabaId ?? ""} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="autoReplyAgentId">Auto-reply AI agent (optional)</Label>
          <Select id="autoReplyAgentId" name="autoReplyAgentId" defaultValue={defaults?.autoReplyAgentId ?? ""}>
            <option value="">No auto-reply</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      {state.ok && <p className="text-sm text-emerald-600">Channel saved.</p>}

      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save channel"}
      </Button>
    </form>
  );
}
