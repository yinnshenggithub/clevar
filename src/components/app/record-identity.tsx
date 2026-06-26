import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/** Overview-tab "Data highlights" strip. */
export function RecordHighlights({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Data highlights</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
          {items.map((it) => (
            <div key={it.label} className="min-w-0">
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">{it.label}</dt>
              <dd className="mt-1 break-words text-sm font-semibold">{it.value ?? <span className="font-normal text-muted-foreground">—</span>}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

/** Left-rail identity header: icon, name, key facts, optional badge row. */
export function RecordIdentity({
  icon,
  title,
  subtitle,
  facts,
  badge,
}: {
  icon: ReactNode;
  title: string;
  subtitle?: ReactNode;
  facts?: { label: string; value: ReactNode }[];
  badge?: ReactNode;
}) {
  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="flex items-start gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            {icon}
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-lg font-bold leading-tight">{title}</h2>
            {subtitle && <div className="mt-0.5 text-sm text-muted-foreground">{subtitle}</div>}
            {badge && <div className="mt-2">{badge}</div>}
          </div>
        </div>
        {facts && facts.length > 0 && (
          <dl className="space-y-2 border-t border-border pt-3 text-sm">
            {facts.map((f) => (
              <div key={f.label} className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2">
                <dt className="text-muted-foreground">{f.label}</dt>
                <dd className="min-w-0 break-words font-medium">{f.value ?? <span className="text-muted-foreground">—</span>}</dd>
              </div>
            ))}
          </dl>
        )}
      </CardContent>
    </Card>
  );
}
