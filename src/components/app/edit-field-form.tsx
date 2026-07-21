"use client";

import { useActionState, useState } from "react";
import { updateField, type FormState } from "@/lib/actions/objects";
import { FIELD_TYPE_LABELS, CORE_RELATION_TARGETS, isRelationType, hasChoices, supportsDefault, relationTarget, selectChoices, type FieldType } from "@/lib/custom-objects";
import { camelKey } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

export function EditFieldForm({
  fieldId,
  token,
  label: initialLabel,
  type,
  required,
  defaultValue,
  options,
  customTargets,
}: {
  fieldId: string;
  token: string;
  label: string;
  type: string;
  required: boolean;
  defaultValue: string | null;
  options: unknown;
  customTargets: { slug: string; nameSingular: string }[];
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    (prev, fd) => updateField(fieldId, token, prev, fd),
    {},
  );
  const [label, setLabel] = useState(initialLabel);
  const choices = selectChoices(options).join(", ");
  const target = relationTarget(options) ?? "contact";
  const derivedKey = camelKey(label) || "—";

  return (
    <form action={formAction} className="space-y-3 rounded-md border border-border p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`label-${fieldId}`}>Field label</Label>
          <Input id={`label-${fieldId}`} name="label" required value={label} onChange={(e) => setLabel(e.target.value)} />
          <p className="text-xs text-muted-foreground">
            Code: <code className="rounded bg-muted px-1 py-0.5 font-mono">{token}.{derivedKey}</code>
          </p>
        </div>
        <div className="space-y-2">
          <Label>Type</Label>
          <div className="flex h-9 items-center">
            <Badge variant="secondary">{FIELD_TYPE_LABELS[type as FieldType] ?? type}</Badge>
            <span className="ml-2 text-xs text-muted-foreground">(type can&apos;t change after creation)</span>
          </div>
        </div>
      </div>
      {hasChoices(type) && (
        <div className="space-y-2">
          <Label htmlFor={`choices-${fieldId}`}>Choices (comma-separated)</Label>
          <Input id={`choices-${fieldId}`} name="choices" defaultValue={choices} placeholder="Lead, Active, Closed" />
        </div>
      )}
      {isRelationType(type) && (
        <div className="space-y-2">
          <Label htmlFor={`relationTarget-${fieldId}`}>Links to</Label>
          <Select id={`relationTarget-${fieldId}`} name="relationTarget" defaultValue={target}>
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
          <Label htmlFor={`defaultValue-${fieldId}`}>Default value (optional)</Label>
          <Input id={`defaultValue-${fieldId}`} name="defaultValue" defaultValue={defaultValue ?? ""} />
        </div>
      )}
      {!isRelationType(type) && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="required" defaultChecked={required} className="h-4 w-4" />
          Required field
        </label>
      )}
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Saving…" : "Save changes"}
      </Button>
    </form>
  );
}
