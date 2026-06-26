"use client";

import { useActionState, useEffect, useRef } from "react";
import { addDocument, type DocState } from "@/lib/actions/knowledge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function KnowledgeForm({ agentId }: { agentId: string }) {
  const [state, formAction, pending] = useActionState<DocState, FormData>(
    (prev, fd) => addDocument(agentId, prev, fd),
    {},
  );
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state]);

  return (
    <form ref={ref} action={formAction} className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor="kb-title">Title</Label>
        <Input id="kb-title" name="title" required placeholder="Pricing FAQ" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="kb-content">Content (paste text)</Label>
        <Textarea id="kb-content" name="content" rows={5} placeholder="Paste the knowledge text here…" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="kb-file">…or upload a .txt / .md file</Label>
        <input
          id="kb-file"
          type="file"
          name="file"
          accept=".txt,.md,text/plain,text/markdown"
          className="block w-full text-sm text-muted-foreground file:mr-4 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-sm file:font-medium"
        />
      </div>
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      {state.ok && <p className="text-sm text-emerald-600">Document added.</p>}
      <Button type="submit" disabled={pending}>
        {pending ? "Adding…" : "Add document"}
      </Button>
    </form>
  );
}
