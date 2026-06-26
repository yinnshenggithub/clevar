"use client";

import { useActionState, useState } from "react";
import { addField, type FormState } from "@/lib/actions/objects";
import { FIELD_TYPES, FIELD_TYPE_LABELS, CORE_RELATION_TARGETS, isRelationType, hasChoices, supportsDefault, type FieldType } from "@/lib/custom-objects";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

export function FieldForm({
  objectId,
  customTargets,
}: {
  objectId: string;
  customTargets: { slug: string; nameSingular: string }[];
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    (prev, fd) => addField(objectId, prev, fd),
    {},
  );
  const [type, setType] = useState<FieldType>("text");

  return (
    <form action={formAction} className="space-y-3 rounded-md border border-border p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="label">Field label</Label>
          <Input id="label" name="label" required placeholder="Address" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="type">Type</Label>
          <Select id="type" name="type" value={type} onChange={(e) => setType(e.target.value as FieldType)}>
            {FIELD_TYPES.map((t) => (
              <option key={t} value={t}>{FIELD_TYPE_LABELS[t]}</option>
            ))}
          </Select>
        </div>
      </div>
      {hasChoices(type) && (
        <div className="space-y-2">
          <Label htmlFor="choices">Choices (comma-separated)</Label>
          <Input id="choices" name="choices" placeholder="Lead, Active, Closed" />
        </div>
      )}
      {isRelationType(type) && (
        <div className="space-y-2">
          <Label htmlFor="relationTarget">Links to</Label>
          <Select id="relationTarget" name="relationTarget" defaultValue="contact">
            {CORE_RELATION_TARGETS.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
            {customTargets.map((t) => (
              <option key={t.slug} value={t.slug}>{t.nameSingular}</option>
            ))}
          </Select>
        </div>
      )}
      {supportsDefault(type) && (
        <div className="space-y-2">
          <Label htmlFor="defaultValue">Default value (optional)</Label>
          <Input id="defaultValue" name="defaultValue" placeholder="Pre-filled when creating a record" />
        </div>
      )}
      {!isRelationType(type) && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="required" className="h-4 w-4" />
          Required field
        </label>
      )}
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Adding…" : "Add field"}
      </Button>
    </form>
  );
}
