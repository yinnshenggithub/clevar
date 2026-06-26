"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface DetailTab {
  key: string;
  label: string;
}

/**
 * HubSpot-style three-column record shell: identity + properties (left, sticky),
 * a tabbed activity area (center, scrolls with the page), and associated/related
 * panels (right, sticky). Tab switching is pure client state — instant, no
 * navigation. All panel content is rendered server-side and passed in as nodes,
 * so navigating between records uses Next soft navigation (no full reload).
 */
export function RecordDetailLayout({
  identity,
  about,
  tabs,
  panels,
  aside,
}: {
  identity: ReactNode;
  about: ReactNode;
  tabs: DetailTab[];
  panels: Record<string, ReactNode>;
  aside: ReactNode;
}) {
  const [active, setActive] = useState(tabs[0]?.key);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[clamp(280px,22vw,340px)_minmax(0,1fr)_clamp(300px,24vw,360px)] lg:items-start">
      {/* Left — identity + properties */}
      <div className="space-y-4 lg:sticky lg:top-0 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto lg:pb-4">
        {identity}
        {about}
      </div>

      {/* Center — tabbed activity */}
      <div className="min-w-0 space-y-4">
        {tabs.length > 1 && (
          <div className="flex items-center gap-1 rounded-xl border border-border bg-card p-1">
            {tabs.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setActive(t.key)}
                className={cn(
                  "flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-colors",
                  active === t.key
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}
        {tabs.map((t) => (
          <div key={t.key} className={active === t.key ? "" : "hidden"}>
            {panels[t.key]}
          </div>
        ))}
      </div>

      {/* Right — associations / related */}
      <div className="space-y-4 lg:sticky lg:top-0 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto lg:pb-4">
        {aside}
      </div>
    </div>
  );
}
