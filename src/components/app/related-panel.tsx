import type { ReactNode } from "react";

/** A titled, framed panel for the right rail — associations / related records. */
export function RelatedPanel({
  title,
  count,
  action,
  children,
}: {
  title: string;
  count?: number;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <h3 className="text-sm font-semibold">
          {title}
          {typeof count === "number" ? <span className="text-muted-foreground"> ({count})</span> : null}
        </h3>
        {action}
      </div>
      <div className="border-t border-border px-4 py-3">{children}</div>
    </div>
  );
}

export function RelatedEmpty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}
