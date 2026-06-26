"use client";

import { useActionState, useEffect, useRef } from "react";
import { addUrlDocument, type DocState } from "@/lib/actions/knowledge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function UrlKnowledgeForm({ agentId }: { agentId: string }) {
  const [state, formAction, pending] = useActionState<DocState, FormData>(
    (prev, fd) => addUrlDocument(agentId, prev, fd),
    {},
  );
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state]);

  return (
    <form ref={ref} action={formAction} className="flex gap-2">
      <Input name="url" type="url" placeholder="https://yoursite.com/faq" className="flex-1" />
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? "Importing…" : "Import URL"}
      </Button>
      {state.error && <p className="text-xs text-destructive">{state.error}</p>}
      {state.ok && <p className="text-xs text-emerald-600">Imported.</p>}
    </form>
  );
}
