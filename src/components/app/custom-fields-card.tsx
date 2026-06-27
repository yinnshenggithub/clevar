import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { FieldDisplay } from "@/lib/object-data";

/** Read-only "Custom fields" card for a record detail page. Hidden when no fields are defined. */
export function CustomFieldsCard({ fields }: { fields: FieldDisplay[] }) {
  if (fields.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Custom fields</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
          {fields.map((f) => (
            <div key={f.key} className="min-w-0">
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">{f.label}</dt>
              <dd className="mt-1 break-words text-sm font-medium">
                {f.display === "—" ? <span className="font-normal text-muted-foreground">—</span> : f.display}
              </dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
