"use client";

import { useActionState } from "react";
import { createObjectDefinition, type FormState } from "@/lib/actions/objects";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ObjectForm() {
  const [state, formAction, pending] = useActionState<FormState, FormData>(createObjectDefinition, {});
  return (
    <form action={formAction} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="nameSingular">Singular name</Label>
          <Input id="nameSingular" name="nameSingular" required placeholder="Property" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="namePlural">Plural name</Label>
          <Input id="namePlural" name="namePlural" required placeholder="Properties" />
        </div>
      </div>
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      <Button type="submit" disabled={pending}>
        {pending ? "Creating…" : "Create object"}
      </Button>
    </form>
  );
}
