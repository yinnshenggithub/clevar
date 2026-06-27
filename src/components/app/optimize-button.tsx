"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Calls the LLM to rewrite an instruction / action guideline, then applies the result. */
export function OptimizeButton({
  value,
  kind,
  onResult,
}: {
  value: string;
  kind: "instructions" | "guideline";
  onResult: (text: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    if (!value.trim() || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/agents/optimize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: value, kind }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.text) setErr(data.error || "Couldn't optimize.");
      else onResult(data.text);
    } catch {
      setErr("Couldn't optimize.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={run} disabled={busy || !value.trim()}>
        <Sparkles className="h-3.5 w-3.5" /> {busy ? "Optimizing…" : "Optimize"}
      </Button>
      {err && <span className="text-xs text-destructive">{err}</span>}
    </div>
  );
}
