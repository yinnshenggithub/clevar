"use client";

import { useState } from "react";

/**
 * Searchable checkbox picker. Submits checked ids under `name` (read with
 * formData.getAll(name)) — far easier than a native multi-select.
 */
export function MultiSelect({
  name,
  options,
  defaultValue = [],
  emptyText = "No options",
}: {
  name: string;
  options: { id: string; label: string }[];
  defaultValue?: string[];
  emptyText?: string;
}) {
  const [q, setQ] = useState("");
  const selected = new Set(defaultValue);
  const showSearch = options.length > 8;
  const filtered = q ? options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase())) : options;

  return (
    <div className="rounded-lg border border-input bg-background">
      {showSearch && (
        <div className="border-b border-border p-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search…"
            className="h-8 w-full rounded-md bg-transparent px-2 text-sm focus:outline-none"
          />
        </div>
      )}
      <div className="max-h-52 overflow-y-auto p-1">
        {filtered.length === 0 ? (
          <p className="px-2 py-3 text-xs text-muted-foreground">{q ? "No matches" : emptyText}</p>
        ) : (
          filtered.map((o) => (
            <label
              key={o.id}
              className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
            >
              <input
                type="checkbox"
                name={name}
                value={o.id}
                defaultChecked={selected.has(o.id)}
                className="h-4 w-4 rounded border-input accent-[hsl(var(--primary))]"
              />
              <span className="truncate">{o.label}</span>
            </label>
          ))
        )}
      </div>
    </div>
  );
}
