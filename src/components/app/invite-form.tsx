"use client";

import { useActionState } from "react";
import { createInvite, type InviteState } from "@/lib/actions/members";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

export function InviteForm() {
  const [state, formAction, pending] = useActionState<InviteState, FormData>(createInvite, {});

  return (
    <div className="space-y-4">
      <form action={formAction} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-2">
          <Label htmlFor="invite-email">Email</Label>
          <Input id="invite-email" name="email" type="email" required placeholder="teammate@company.com" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="invite-role">Role</Label>
          <Select id="invite-role" name="role" defaultValue="MEMBER">
            <option value="MEMBER">Member</option>
            <option value="ADMIN">Admin</option>
          </Select>
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create invite"}
        </Button>
      </form>

      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      {state.link && (
        <div className="rounded-md border border-border bg-secondary/50 p-3 text-sm">
          <p className="mb-1 font-medium">Invite link created — share it with your teammate:</p>
          <code className="block break-all text-xs text-muted-foreground">{state.link}</code>
        </div>
      )}
    </div>
  );
}
