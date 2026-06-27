"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { MultiSelect } from "@/components/ui/multi-select";

export interface RecordFieldDef {
  key: string;
  label: string;
  type: string;
  required: boolean;
  defaultValue: string | null;
  choices: string[];
  relOptions: { id: string; label: string }[];
}

/**
 * Renders the inputs for a list of user-defined fields. Used standalone by RecordForm
 * (custom objects) and embedded inside the built-in object forms. Returns null when there
 * are no fields so it can be dropped into a form unconditionally.
 */
export function CustomFieldset({
  fields,
  defaults,
}: {
  fields: RecordFieldDef[];
  defaults?: Record<string, unknown>;
}) {
  if (fields.length === 0) return null;
  const init = (f: RecordFieldDef) => {
    const v = defaults?.[f.key];
    if (v != null) return String(v);
    return f.defaultValue ?? "";
  };

  return (
    <>
      {fields.map((f) => (
        <div key={f.key} className="space-y-2">
          <Label htmlFor={f.key}>
            {f.label}
            {f.required && <span className="ml-0.5 text-destructive">*</span>}
          </Label>
          {f.type === "boolean" ? (
            <div>
              <input id={f.key} name={f.key} type="checkbox" defaultChecked={defaults?.[f.key] === true} className="h-4 w-4" />
            </div>
          ) : f.type === "number" ? (
            <Input id={f.key} name={f.key} type="number" step="any" required={f.required} defaultValue={init(f)} />
          ) : f.type === "currency" ? (
            <Input id={f.key} name={f.key} type="number" step="0.01" min="0" required={f.required} defaultValue={init(f)} />
          ) : f.type === "rating" ? (
            <Select id={f.key} name={f.key} required={f.required} defaultValue={init(f)}>
              <option value="">—</option>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>{"★".repeat(n)}</option>
              ))}
            </Select>
          ) : f.type === "url" ? (
            <Input id={f.key} name={f.key} type="url" required={f.required} placeholder="https://…" defaultValue={init(f)} />
          ) : f.type === "email" ? (
            <Input id={f.key} name={f.key} type="email" required={f.required} defaultValue={init(f)} />
          ) : f.type === "phone" ? (
            <Input id={f.key} name={f.key} type="tel" required={f.required} defaultValue={init(f)} />
          ) : f.type === "rich_text" ? (
            <Textarea id={f.key} name={f.key} rows={4} required={f.required} defaultValue={init(f)} />
          ) : f.type === "date" ? (
            <Input id={f.key} name={f.key} type="date" required={f.required} defaultValue={init(f)} />
          ) : f.type === "select" ? (
            <Select id={f.key} name={f.key} required={f.required} defaultValue={init(f)}>
              <option value="">—</option>
              {f.choices.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </Select>
          ) : f.type === "multi_select" ? (
            <MultiSelect
              name={f.key}
              options={f.choices.map((c) => ({ id: c, label: c }))}
              defaultValue={Array.isArray(defaults?.[f.key]) ? (defaults[f.key] as string[]) : []}
              emptyText="No choices defined"
            />
          ) : f.type === "relation" ? (
            <Select id={f.key} name={f.key} defaultValue={init(f)}>
              <option value="">— none —</option>
              {f.relOptions.map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </Select>
          ) : f.type === "relations" ? (
            <MultiSelect
              name={f.key}
              options={f.relOptions}
              defaultValue={Array.isArray(defaults?.[f.key]) ? (defaults[f.key] as string[]) : []}
              emptyText="No records to link"
            />
          ) : (
            <Input id={f.key} name={f.key} required={f.required} defaultValue={init(f)} />
          )}
        </div>
      ))}
    </>
  );
}
