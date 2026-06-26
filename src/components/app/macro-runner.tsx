"use client";

import { useState, useTransition } from "react";
import { Zap } from "lucide-react";
import { runMacro } from "@/lib/actions/macros";
import { Button } from "@/components/ui/button";

export function MacroRunner({
  conversationId,
  macros,
}: {
  conversationId: string;
  macros: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  if (macros.length === 0) return null;

  return (
    <div className="relative">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8 gap-1 text-xs"
        disabled={pending}
        onClick={() => setOpen((o) => !o)}
      >
        <Zap className="h-3.5 w-3.5" /> Macro
      </Button>
      {open && (
        <>
          <button className="fixed inset-0 z-10 cursor-default" aria-hidden tabIndex={-1} onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-52 rounded-lg border border-border bg-card p-1 shadow-card">
            {macros.map((m) => (
              <button
                key={m.id}
                type="button"
                disabled={pending}
                onClick={() => {
                  setOpen(false);
                  start(() => void runMacro(m.id, conversationId));
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
              >
                <Zap className="h-3.5 w-3.5 text-primary" /> {m.name}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
