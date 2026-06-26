"use client";

import { useActionState, useEffect, useRef } from "react";
import type { ObjectType } from "@prisma/client";
import { addNote, type NoteState } from "@/lib/actions/notes";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function NoteComposer({ parentType, parentId }: { parentType: ObjectType; parentId: string }) {
  const [state, formAction, pending] = useActionState<NoteState, FormData>(
    (prev, fd) => addNote(parentType, parentId, prev, fd),
    {},
  );
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state]);

  return (
    <form ref={ref} action={formAction} className="space-y-2">
      <Textarea name="body" rows={2} placeholder="Write a note…" className="resize-none" />
      {state.error && <p className="text-xs text-destructive">{state.error}</p>}
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Add note"}
        </Button>
      </div>
    </form>
  );
}
