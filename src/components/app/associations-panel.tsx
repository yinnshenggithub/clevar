"use client";

import Link from "next/link";
import { X } from "lucide-react";
import { addAssociation, removeAssociation } from "@/lib/actions/associations";
import type { AssociationView } from "@/lib/associations";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Addable {
  associationTypeId: string;
  label: string;
  cardinality: string;
  otherObject: string;
  options: { id: string; label: string }[];
}

export function AssociationsPanel({
  record,
  views,
  addable,
}: {
  record: { type: string; id: string };
  views: AssociationView[];
  addable: Addable[];
}) {
  // Group existing links by their (side-appropriate) label.
  const groups = new Map<string, AssociationView[]>();
  for (const v of views) {
    if (!groups.has(v.label)) groups.set(v.label, []);
    groups.get(v.label)!.push(v);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Associations</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {groups.size === 0 && addable.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No association types apply to this record. Define one in Settings → Associations.
          </p>
        )}

        {[...groups.entries()].map(([label, rows]) => (
          <div key={label} className="space-y-1.5">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
            <ul className="divide-y divide-border">
              {rows.map((v) => (
                <li key={v.edgeId} className="flex items-center justify-between gap-2 py-2">
                  <Link href={v.other.href} className="truncate text-sm font-medium hover:underline">
                    {v.other.title}
                    <span className="ml-1 text-xs text-muted-foreground">· {v.other.nameSingular}</span>
                  </Link>
                  <form action={removeAssociation.bind(null, v.edgeId, record.type, record.id)}>
                    <button type="submit" className="text-muted-foreground hover:text-destructive" aria-label="Remove association">
                      <X className="h-4 w-4" />
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          </div>
        ))}

        {addable.length > 0 && (
          <div className="space-y-3 border-t border-border pt-3">
            {addable.map((a) => (
              <form key={a.associationTypeId} action={addAssociation.bind(null, record.type, record.id)} className="space-y-1.5">
                <div className="text-xs font-medium text-muted-foreground">Add {a.label}</div>
                <div className="flex gap-2">
                  <input type="hidden" name="associationTypeId" value={a.associationTypeId} />
                  <Select name="otherId" className="flex-1" defaultValue="" aria-label={`Add ${a.label}`}>
                    <option value="">Select a record…</option>
                    {a.options.map((o) => (
                      <option key={o.id} value={o.id}>{o.label}</option>
                    ))}
                  </Select>
                  <Button type="submit" variant="outline" size="sm">Add</Button>
                </div>
              </form>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
