"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import type { FormState } from "@/lib/actions/objects";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

export interface RecordFieldDef {
  key: string;
  label: string;
  type: string;
  choices: string[];
  relOptions: { id: string; label: string }[];
}

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
  const val = (k: string) => {
    const v = defaults?.[k];
    return v == null ? "" : String(v);
  };

  return (
    <form action={formAction} className="max-w-2xl space-y-5">
      {fields.length === 0 && (
        <p className="text-sm text-muted-foreground">This object has no fields yet. Add fields first.</p>
      )}
      {fields.map((f) => (
        <div key={f.key} className="space-y-2">
          <Label htmlFor={f.key}>{f.label}</Label>
          {f.type === "boolean" ? (
            <div>
              <input id={f.key} name={f.key} type="checkbox" defaultChecked={defaults?.[f.key] === true} className="h-4 w-4" />
            </div>
          ) : f.type === "number" ? (
            <Input id={f.key} name={f.key} type="number" step="any" defaultValue={val(f.key)} />
          ) : f.type === "date" ? (
            <Input id={f.key} name={f.key} type="date" defaultValue={val(f.key)} />
          ) : f.type === "select" ? (
            <Select id={f.key} name={f.key} defaultValue={val(f.key)}>
              <option value="">—</option>
              {f.choices.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </Select>
          ) : f.type === "relation" ? (
            <Select id={f.key} name={f.key} defaultValue={val(f.key)}>
              <option value="">— none —</option>
              {f.relOptions.map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </Select>
          ) : f.type === "relations" ? (
            <>
              <select
                id={f.key}
                name={f.key}
                multiple
                defaultValue={Array.isArray(defaults?.[f.key]) ? (defaults[f.key] as string[]) : []}
                className="flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                {f.relOptions.map((o) => (
                  <option key={o.id} value={o.id}>{o.label}</option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">Hold ⌘ / Ctrl to select multiple.</p>
            </>
          ) : (
            <Input id={f.key} name={f.key} defaultValue={val(f.key)} />
          )}
        </div>
      ))}

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
