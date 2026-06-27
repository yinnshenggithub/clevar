"use client";

import { useActionState } from "react";
import { Plus } from "lucide-react";
import { createPipeline, type FormState } from "@/lib/actions/pipelines";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function CreatePipelineForm() {
  const [state, formAction, pending] = useActionState<FormState, FormData>(createPipeline, {});
  return (
    <form action={formAction} className="space-y-2">
      <div className="flex gap-2">
        <Input name="name" placeholder="New pipeline name" required className="flex-1" />
        <Button type="submit" disabled={pending} className="shrink-0 gap-1">
          <Plus className="h-4 w-4" /> {pending ? "Creating…" : "Create pipeline"}
        </Button>
      </div>
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
    </form>
  );
}
