"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import type { FormState } from "@/lib/actions/agents";
import { MODEL_OPTIONS, DEFAULT_MODEL } from "@/lib/ai-models";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";

export interface AgentDefaults {
  name?: string | null;
  instructions?: string | null;
  model?: string | null;
}

export function AgentForm({
  action,
  defaults,
  submitLabel,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  defaults?: AgentDefaults;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, {});
  const router = useRouter();

  return (
    <form action={formAction} className="max-w-2xl space-y-5">
      <div className="space-y-2">
        <Label htmlFor="name">Agent name</Label>
        <Input id="name" name="name" required defaultValue={defaults?.name ?? ""} placeholder="Support Assistant" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="model">Model</Label>
        <Select id="model" name="model" defaultValue={defaults?.model ?? DEFAULT_MODEL}>
          {MODEL_OPTIONS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="instructions">Instructions / context</Label>
        <Textarea
          id="instructions"
          name="instructions"
          rows={8}
          defaultValue={defaults?.instructions ?? ""}
          placeholder="Describe the agent's role, tone, and the context it should use. e.g. 'You are a friendly support agent for Acme. Answer questions about our pricing and onboarding.'"
        />
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
