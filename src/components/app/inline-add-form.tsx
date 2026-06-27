"use client";

import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";

/** Compact "pick one + Add" form for linking an existing record from a related-records panel. */
export function InlineAddForm({
  action,
  options,
  placeholder,
  submitLabel = "Add",
}: {
  action: (formData: FormData) => void | Promise<void>;
  options: { id: string; label: string }[];
  placeholder: string;
  submitLabel?: string;
}) {
  if (options.length === 0) return null;
  return (
    <form action={action} className="mt-3 flex gap-2">
      <Select name="targetId" defaultValue="" aria-label={placeholder} className="min-w-0 flex-1">
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </Select>
      <Button type="submit" variant="outline" size="sm" className="shrink-0 gap-1">
        <Plus className="h-4 w-4" />
        {submitLabel}
      </Button>
    </form>
  );
}
