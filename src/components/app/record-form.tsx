"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import type { FormState } from "@/lib/actions/objects";
import { Button } from "@/components/ui/button";
import { CustomFieldset, type RecordFieldDef } from "@/components/app/custom-fieldset";

export type { RecordFieldDef };

export function RecordForm({
  action,
  fields,
  defaults,
  submitLabel,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  fields: RecordFieldDef[];
  defaults?: Record<string, unknown>;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, {});
  const router = useRouter();

  return (
    <form action={formAction} className="max-w-2xl space-y-5">
      {fields.length === 0 && (
        <p className="text-sm text-muted-foreground">This object has no fields yet. Add fields first.</p>
      )}
      <CustomFieldset fields={fields} defaults={defaults} />

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
