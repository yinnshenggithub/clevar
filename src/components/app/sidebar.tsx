"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Boxes, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { NAV_ITEMS } from "./nav-items";

export function Sidebar({
  workspaceName,
  customObjects = [],
  favorites = [],
}: {
  workspaceName: string;
  customObjects?: { slug: string; namePlural: string }[];
  favorites?: { label: string; href: string }[];
}) {
  const pathname = usePathname();
  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-card md:flex">
      <div className="flex h-16 items-center gap-2 border-b border-border px-5 font-display text-lg font-bold tracking-tight">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary font-display text-primary-foreground shadow-soft">
          C
        </span>
        Clevar
      </div>
      <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {workspaceName}
      </div>
      <nav className="flex flex-1 flex-col gap-1 px-3 py-2">
        {NAV_ITEMS.map((item) => {
          const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}

        {favorites.length > 0 && (
          <>
            <div className="px-3 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Favorites
            </div>
            {favorites.map((f) => {
              const active = pathname === f.href;
              return (
                <Link
                  key={f.href}
                  href={f.href}
                  className={cn(
                    "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                  )}
                >
                  <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
                  <span className="truncate">{f.label}</span>
                </Link>
              );
            })}
          </>
        )}

        {customObjects.length > 0 && (
          <>
            <div className="px-3 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Objects
            </div>
            {customObjects.map((o) => {
              const href = `/app/o/${o.slug}`;
              const active = pathname.startsWith(href);
              return (
                <Link
                  key={o.slug}
                  href={href}
                  className={cn(
                    "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                  )}
                >
                  <Boxes className="h-4 w-4" />
                  {o.namePlural}
                </Link>
              );
            })}
          </>
        )}
      </nav>
    </aside>
  );
}
