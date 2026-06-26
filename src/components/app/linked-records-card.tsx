import Link from "next/link";
import type { LinkedRecord } from "@/lib/object-data";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function LinkedRecordsCard({ linked }: { linked: LinkedRecord[] }) {
  if (linked.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Linked records</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-border">
          {linked.map((l) => (
            <li key={l.recordId} className="flex items-center justify-between gap-2 py-2">
              <Link href={`/app/o/${l.slug}/${l.recordId}`} className="text-sm font-medium hover:underline">
                {l.title}
              </Link>
              <span className="text-xs text-muted-foreground">
                {l.nameSingular} · {l.fieldLabel}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
