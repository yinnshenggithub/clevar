"use client";

import { useActionState } from "react";
import { createAssociationType, type FormState } from "@/lib/actions/associations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

export function AssociationTypeForm({ objects }: { objects: { value: string; label: string }[] }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(createAssociationType, {});

  return (
    <form action={formAction} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="fromObject">From object</Label>
          <Select id="fromObject" name="fromObject" defaultValue="company">
            {objects.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="toObject">To object</Label>
          <Select id="toObject" name="toObject" defaultValue="contact">
            {objects.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </Select>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="label">Label (shown on the from record)</Label>
          <Input id="label" name="label" required placeholder="e.g. Employees" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="inverseLabel">Inverse label (shown on the to record)</Label>
          <Input id="inverseLabel" name="inverseLabel" required placeholder="e.g. Employer" />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="cardinality">Cardinality</Label>
        <Select id="cardinality" name="cardinality" defaultValue="many_to_many">
          <option value="one_to_one">One-to-one</option>
          <option value="one_to_many">One-to-many</option>
          <option value="many_to_many">Many-to-many</option>
        </Select>
      </div>
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Create association type"}</Button>
    </form>
  );
}
